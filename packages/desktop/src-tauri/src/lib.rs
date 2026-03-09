mod cli;
mod constants;
mod server;
mod window_commands;
mod windows;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use crate::cli::CommandChild;
use futures::{
    FutureExt,
    future::{self, Shared},
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, State, ipc::Channel, path::BaseDirectory};
#[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::{
    sync::{oneshot, watch},
    time::timeout,
};

use crate::constants::*;
use crate::server::get_saved_server_url;
use crate::windows::MainWindow;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSWindow;

const FRONTEND_LOG_FILE: &str = "frontend-console.log";
const FRONTEND_LOG_MAX_BYTES: u64 = 10 * 1024 * 1024;
const FRONTEND_LOG_BACKUPS: usize = 3;

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
struct ServerReadyData {
    url: String,
    password: Option<String>,
}

#[derive(Clone, Copy, serde::Deserialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ScreenshotBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, serde::Serialize, specta::Type, Debug)]
#[serde(rename_all = "camelCase")]
struct ScreenshotCaptureResult {
    success: bool,
    data_url: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Copy, serde::Serialize, specta::Type, Debug)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum InitStep {
    ServerWaiting,
    Done,
}

struct InitState {
    current: watch::Receiver<InitStep>,
}

#[derive(Clone)]
struct ServerState {
    child: Arc<Mutex<Option<CommandChild>>>,
    status: future::Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
}

impl ServerState {
    pub fn new(
        child: Option<CommandChild>,
        status: Shared<oneshot::Receiver<Result<ServerReadyData, String>>>,
    ) -> Self {
        Self {
            child: Arc::new(Mutex::new(child)),
            status,
        }
    }

    pub fn set_child(&self, child: Option<CommandChild>) {
        *self.child.lock().unwrap() = child;
    }
}

#[tauri::command]
#[specta::specta]
fn kill_sidecar(app: AppHandle) {
    let Some(server_state) = app.try_state::<ServerState>() else {
        tracing::info!("Server not running");
        return;
    };

    let Some(server_state) = server_state
        .child
        .lock()
        .expect("Failed to acquire mutex lock")
        .take()
    else {
        tracing::info!("Server state missing");
        return;
    };

    let _ = server_state.kill();

    tracing::info!("Killed bfloat sidecar");
}

#[tauri::command]
#[specta::specta]
async fn await_initialization(
    state: State<'_, ServerState>,
    init_state: State<'_, InitState>,
    events: Channel<InitStep>,
) -> Result<ServerReadyData, String> {
    let mut rx = init_state.current.clone();

    let events = async {
        let e = *rx.borrow();
        let _ = events.send(e);

        while rx.changed().await.is_ok() {
            let step = *rx.borrow_and_update();

            let _ = events.send(step);

            if matches!(step, InitStep::Done) {
                break;
            }
        }
    };

    future::join(state.status.clone(), events)
        .await
        .0
        .map_err(|_| "Failed to get server status".to_string())?
}

#[tauri::command]
#[specta::specta]
fn append_frontend_log(app: AppHandle, line: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Ok(());
    }

    let base = app
        .path()
        .resolve("", BaseDirectory::AppLocalData)
        .map_err(|e| format!("Failed to resolve app local data dir: {e}"))?;

    let log_dir = base.join("logs");
    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {e}"))?;

    let log_file: PathBuf = log_dir.join(FRONTEND_LOG_FILE);
    rotate_frontend_log_if_needed(&log_file)?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| format!("Failed to open log file {:?}: {e}", log_file))?;

    writeln!(file, "{line}").map_err(|e| format!("Failed to append frontend log: {e}"))?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn capture_preview_screenshot(
    app: AppHandle,
    bounds: ScreenshotBounds,
    device_pixel_ratio: Option<f64>,
) -> ScreenshotCaptureResult {
    if !(bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.x.is_finite()
        && bounds.y.is_finite())
    {
        return ScreenshotCaptureResult {
            success: false,
            data_url: None,
            error: Some("Screenshot bounds must be finite numbers.".to_string()),
        };
    }

    if bounds.width < 1.0 || bounds.height < 1.0 {
        return ScreenshotCaptureResult {
            success: false,
            data_url: None,
            error: Some("Screenshot bounds must be at least 1px by 1px.".to_string()),
        };
    }

    #[cfg(target_os = "macos")]
    {
        let _ = device_pixel_ratio;
        match capture_preview_screenshot_macos(app, bounds) {
            Ok(result) => result,
            Err(error) => ScreenshotCaptureResult {
                success: false,
                data_url: None,
                error: Some(error),
            },
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = device_pixel_ratio;
        ScreenshotCaptureResult {
            success: false,
            data_url: None,
            error: Some("Native preview screenshot is currently only implemented on macOS.".to_string()),
        }
    }
}

#[cfg(target_os = "macos")]
fn capture_preview_screenshot_macos(
    app: AppHandle,
    bounds: ScreenshotBounds,
) -> Result<ScreenshotCaptureResult, String> {
    let window = app
        .get_webview_window(MainWindow::LABEL)
        .ok_or_else(|| "Main window not found".to_string())?;

    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;
    let inner_position = window.inner_position().map_err(|e| e.to_string())?;
    let screenshot_rect = format!(
        "{},{},{},{}",
        ((inner_position.x as f64) / scale_factor + bounds.x).round() as i32,
        ((inner_position.y as f64) / scale_factor + bounds.y).round() as i32,
        bounds.width.round().max(1.0) as i32,
        bounds.height.round().max(1.0) as i32,
    );

    // Best-effort window validation so errors are clearer when capture fails.
    let ns_window = window.ns_window().map_err(|e| e.to_string())?;
    let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
    let window_number = ns_window.windowNumber();
    if window_number <= 0 {
        return Err("Could not resolve native macOS window number for screenshot capture.".to_string());
    }

    let temp_path =
        std::env::temp_dir().join(format!("bfloat-preview-screenshot-{}.png", uuid::Uuid::new_v4()));

    let output = StdCommand::new("screencapture")
        .args(["-x", &format!("-R{screenshot_rect}")])
        .arg(&temp_path)
        .output()
        .map_err(|e| format!("Failed to run screencapture: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        return Err(format!("macOS screenshot capture failed: {detail}"));
    }

    let bytes = fs::read(&temp_path)
        .map_err(|e| format!("Failed to read screenshot output {:?}: {e}", temp_path))?;
    let _ = fs::remove_file(&temp_path);

    Ok(ScreenshotCaptureResult {
        success: true,
        data_url: Some(format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(bytes)
        )),
        error: None,
    })
}

fn rotate_frontend_log_if_needed(log_file: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::metadata(log_file) else {
        return Ok(());
    };

    if metadata.len() < FRONTEND_LOG_MAX_BYTES {
        return Ok(());
    }

    // Remove the oldest backup first so renames below can succeed consistently.
    let oldest = log_file.with_extension(format!("log.{}", FRONTEND_LOG_BACKUPS));
    if oldest.exists() {
        fs::remove_file(&oldest)
            .map_err(|e| format!("Failed to remove oldest log backup {:?}: {e}", oldest))?;
    }

    for idx in (1..=FRONTEND_LOG_BACKUPS).rev() {
        let src = if idx == 1 {
            log_file.to_path_buf()
        } else {
            log_file.with_extension(format!("log.{}", idx - 1))
        };
        let dst = log_file.with_extension(format!("log.{}", idx));

        if !src.exists() {
            continue;
        }

        if dst.exists() {
            fs::remove_file(&dst)
                .map_err(|e| format!("Failed to remove rotated log {:?}: {e}", dst))?;
        }

        fs::rename(&src, &dst)
            .map_err(|e| format!("Failed to rotate log {:?} -> {:?}: {e}", src, dst))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = make_specta_builder();

    #[cfg(debug_assertions)] // <- Only export on non-release builds
    export_types(&builder);

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("killall")
        .arg("bfloat-sidecar")
        .output();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when another instance is launched
            if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_decorum::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            let handle = app.handle().clone();

            builder.mount_events(&handle);
            tauri::async_runtime::spawn(initialize(handle));

            Ok(())
        });

    if UPDATER_ENABLED {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                tracing::info!("Received Exit event");
                kill_sidecar(app.clone());
            }
        });
}

fn make_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            kill_sidecar,
            await_initialization,
            append_frontend_log,
            capture_preview_screenshot,
            server::get_default_server_url,
            server::set_default_server_url,
            window_commands::window_minimize,
            window_commands::window_maximize,
            window_commands::window_close,
            window_commands::window_maximize_toggle,
            window_commands::window_is_maximized,
            window_commands::window_is_fullscreen,
            window_commands::window_toggle_fullscreen,
            window_commands::window_set_background_color,
            window_commands::open_url,
        ])
        .events(tauri_specta::collect_events![])
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
}

fn export_types(builder: &tauri_specta::Builder<tauri::Wry>) {
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");
}

#[cfg(test)]
#[test]
fn test_export_types() {
    let builder = make_specta_builder();
    export_types(&builder);
}

async fn initialize(app: AppHandle) {
    tracing::info!("Initializing Bfloat IDE");

    let (init_tx, init_rx) = watch::channel(InitStep::ServerWaiting);

    setup_app(&app, init_rx);

    let (server_ready_tx, server_ready_rx) = oneshot::channel();
    let server_ready_rx = server_ready_rx.shared();
    app.manage(ServerState::new(None, server_ready_rx.clone()));

    let loading_task = tokio::spawn({
        let app = app.clone();

        async move {
            tracing::info!("Setting up server connection");
            let server_connection = setup_server_connection(app.clone()).await;
            tracing::info!("Server connection setup complete");

            match server_connection {
                ServerConnection::CLI {
                    child,
                    health_check,
                    url,
                    password,
                } => {
                    let res = timeout(Duration::from_secs(30), health_check.0).await;
                    let err = match res {
                        Ok(Ok(Ok(()))) => None,
                        Ok(Ok(Err(e))) => Some(e),
                        Ok(Err(e)) => Some(format!("Health check task failed: {e}")),
                        Err(_) => Some("Health check timed out".to_string()),
                    };

                    if let Some(err) = err {
                        let _ = child.kill();
                        let _ = server_ready_tx
                            .send(Err(format!("Failed to start Bfloat server: {err}")));
                        return;
                    }

                    tracing::info!("Sidecar health check OK");
                    app.state::<ServerState>().set_child(Some(child));
                    let _ = server_ready_tx.send(Ok(ServerReadyData { url, password }));
                }
                ServerConnection::Existing { url } => {
                    let _ = server_ready_tx.send(Ok(ServerReadyData {
                        url: url.to_string(),
                        password: None,
                    }));
                }
            };

            tracing::info!("Loading task finished");
        }
    });

    let _ = loading_task.await;
    let _ = server_ready_rx.await;

    tracing::info!("Initialization complete, creating main window");
    let _ = init_tx.send(InitStep::Done);

    MainWindow::create(&app).expect("Failed to create main window");
}

fn setup_app(app: &tauri::AppHandle, init_rx: watch::Receiver<InitStep>) {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all().ok();

    app.manage(InitState { current: init_rx });
}

enum ServerConnection {
    Existing {
        url: String,
    },
    CLI {
        url: String,
        password: Option<String>,
        child: CommandChild,
        health_check: server::HealthCheck,
    },
}

async fn setup_server_connection(app: AppHandle) -> ServerConnection {
    let custom_url = get_saved_server_url(&app).await;

    tracing::info!(?custom_url, "Attempting server connection");

    if let Some(url) = custom_url {
        if server::check_health_or_ask_retry(&app, &url).await {
            tracing::info!(%url, "Connected to custom server");
            return ServerConnection::Existing { url: url.clone() };
        }
    }

    let local_port = get_sidecar_port();
    let hostname = "127.0.0.1";
    let local_url = format!("http://{hostname}:{local_port}");

    tracing::debug!(url = %local_url, "Checking health of local server");
    if server::check_health(&local_url, None).await {
        tracing::info!(url = %local_url, "Health check OK, using existing server");
        return ServerConnection::Existing { url: local_url };
    }

    let password = uuid::Uuid::new_v4().to_string();

    tracing::info!("Spawning new local bfloat server");
    let (child, health_check) =
        server::spawn_local_server(app, hostname.to_string(), local_port, password.clone());

    ServerConnection::CLI {
        url: local_url,
        password: Some(password),
        child,
        health_check,
    }
}

fn get_sidecar_port() -> u32 {
    option_env!("BFLOAT_PORT")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("BFLOAT_PORT").ok())
        .and_then(|port_str| port_str.parse().ok())
        .unwrap_or_else(|| {
            TcpListener::bind("127.0.0.1:0")
                .expect("Failed to bind to find free port")
                .local_addr()
                .expect("Failed to get local address")
                .port()
        }) as u32
}
