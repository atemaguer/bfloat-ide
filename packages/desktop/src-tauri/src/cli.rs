use futures::{Stream, StreamExt, future};
use process_wrap::tokio::CommandWrap;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
#[cfg(windows)]
use process_wrap::tokio::{JobObject, KillOnDrop};
#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;
use std::sync::Arc;
use std::{process::Stdio, time::Duration};
use tauri::{AppHandle, Manager, path::BaseDirectory};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
    task::JoinHandle,
};
use tokio_stream::wrappers::ReceiverStream;
use tracing::Instrument;

#[derive(Clone, Debug)]
pub enum CommandEvent {
    Stdout(String),
    Stderr(String),
    Error(String),
    Terminated(TerminatedPayload),
}

#[derive(Clone, Copy, Debug)]
pub struct TerminatedPayload {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct CommandChild {
    kill: mpsc::Sender<()>,
}

impl CommandChild {
    pub fn kill(&self) -> std::io::Result<()> {
        self.kill
            .try_send(())
            .map_err(|e| std::io::Error::other(e.to_string()))
    }
}

pub fn get_sidecar_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    // Get binary with symlinks support
    tauri::process::current_binary(&app.env())
        .expect("Failed to get current binary")
        .parent()
        .expect("Failed to get parent dir")
        .join("bfloat-sidecar")
}

fn get_user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

#[allow(dead_code)]
fn shell_escape(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }

    let mut escaped = String::from("'");
    escaped.push_str(&input.replace("'", "'\"'\"'"));
    escaped.push('\'');
    escaped
}

pub fn spawn_command(
    app: &tauri::AppHandle,
    args: &str,
    extra_env: &[(&str, String)],
) -> Result<(impl Stream<Item = CommandEvent> + 'static, CommandChild), std::io::Error> {
    let state_dir = app
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .expect("Failed to resolve app local data dir");

    let mut envs = vec![
        ("BFLOAT_CLIENT".to_string(), "desktop".to_string()),
        (
            "XDG_STATE_HOME".to_string(),
            state_dir.to_string_lossy().to_string(),
        ),
    ];
    envs.extend(
        extra_env
            .iter()
            .map(|(key, value)| (key.to_string(), value.clone())),
    );

    let mut cmd = if cfg!(windows) {
        let sidecar = get_sidecar_path(app);
        let mut cmd = Command::new(sidecar);
        cmd.args(args.split_whitespace());

        for (key, value) in envs {
            cmd.env(key, value);
        }

        cmd
    } else {
        let sidecar = get_sidecar_path(app);
        let shell = get_user_shell();

        let line = if shell.ends_with("/nu") {
            format!("^\"{}\" {}", sidecar.display(), args)
        } else {
            format!("\"{}\" {}", sidecar.display(), args)
        };

        let mut cmd = Command::new(shell);
        cmd.args(["-l", "-c", &line]);

        for (key, value) in envs {
            cmd.env(key, value);
        }

        cmd
    };

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let mut wrap = CommandWrap::from(cmd);

    #[cfg(unix)]
    {
        wrap.wrap(ProcessGroup::leader());
    }

    #[cfg(windows)]
    {
        wrap.wrap(JobObject).wrap(KillOnDrop);
    }

    let mut child = wrap.spawn()?;
    let guard = Arc::new(tokio::sync::RwLock::new(()));
    let (tx, rx) = mpsc::channel(256);
    let (kill_tx, mut kill_rx) = mpsc::channel(1);

    let stdout = spawn_pipe_reader(
        tx.clone(),
        guard.clone(),
        BufReader::new(child.stdout().take().unwrap()),
        CommandEvent::Stdout,
    );
    let stderr = spawn_pipe_reader(
        tx.clone(),
        guard.clone(),
        BufReader::new(child.stderr().take().unwrap()),
        CommandEvent::Stderr,
    );

    tokio::task::spawn(async move {
        let mut kill_open = true;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(err) => break Err(err),
            }

            tokio::select! {
                msg = kill_rx.recv(), if kill_open => {
                    if msg.is_some() {
                        let _ = child.start_kill();
                    }
                    kill_open = false;
                }
                _ = tokio::time::sleep(Duration::from_millis(100)) => {}
            }
        };

        match status {
            Ok(status) => {
                let payload = TerminatedPayload {
                    code: status.code(),
                    signal: signal_from_status(status),
                };
                let _ = tx.send(CommandEvent::Terminated(payload)).await;
            }
            Err(err) => {
                let _ = tx.send(CommandEvent::Error(err.to_string())).await;
            }
        }

        stdout.abort();
        stderr.abort();
    });

    let event_stream = ReceiverStream::new(rx);

    Ok((event_stream, CommandChild { kill: kill_tx }))
}

fn signal_from_status(status: std::process::ExitStatus) -> Option<i32> {
    #[cfg(unix)]
    return status.signal();

    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

pub fn serve(
    app: &AppHandle,
    hostname: &str,
    port: u32,
    password: &str,
) -> (CommandChild, oneshot::Receiver<TerminatedPayload>) {
    let (exit_tx, exit_rx) = oneshot::channel::<TerminatedPayload>();

    tracing::info!(port, "Spawning bfloat sidecar");

    let envs = [
        ("BFLOAT_SERVER_USERNAME", "bfloat".to_string()),
        ("BFLOAT_SERVER_PASSWORD", password.to_string()),
    ];

    let (events, child) = spawn_command(
        app,
        format!("serve --hostname {hostname} --port {port} --password {password}").as_str(),
        &envs,
    )
    .expect("Failed to spawn bfloat sidecar");

    let mut exit_tx = Some(exit_tx);
    tokio::spawn(
        events
            .for_each(move |event| {
                match event {
                    CommandEvent::Stdout(line) => {
                        tracing::info!("{line}");
                    }
                    CommandEvent::Stderr(line) => {
                        tracing::info!("{line}");
                    }
                    CommandEvent::Error(err) => {
                        tracing::error!("{err}");
                    }
                    CommandEvent::Terminated(payload) => {
                        tracing::info!(
                            code = ?payload.code,
                            signal = ?payload.signal,
                            "Sidecar terminated"
                        );

                        if let Some(tx) = exit_tx.take() {
                            let _ = tx.send(payload);
                        }
                    }
                }

                future::ready(())
            })
            .instrument(tracing::info_span!("bfloat-sidecar")),
    );

    (child, exit_rx)
}

fn spawn_pipe_reader<F: Fn(String) -> CommandEvent + Send + Copy + 'static>(
    tx: mpsc::Sender<CommandEvent>,
    guard: Arc<tokio::sync::RwLock<()>>,
    pipe_reader: impl AsyncBufRead + Send + Unpin + 'static,
    wrapper: F,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let _lock = guard.read().await;
        let reader = BufReader::new(pipe_reader);

        read_line(reader, tx, wrapper).await;
    })
}

async fn read_line<F: Fn(String) -> CommandEvent + Send + Copy + 'static>(
    reader: BufReader<impl AsyncBufRead + Unpin>,
    tx: mpsc::Sender<CommandEvent>,
    wrapper: F,
) {
    let mut lines = reader.lines();
    loop {
        let line = lines.next_line().await;

        match line {
            Ok(s) => {
                if let Some(s) = s {
                    let _ = tx.clone().send(wrapper(s)).await;
                }
            }
            Err(e) => {
                let tx_ = tx.clone();
                let _ = tx_.send(CommandEvent::Error(e.to_string())).await;
                break;
            }
        }
    }
}
