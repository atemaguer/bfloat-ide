use crate::constants::{window_state_flags, UPDATER_ENABLED};
use std::{ops::Deref, time::Duration};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_window_state::AppHandleExt;
use tokio::sync::mpsc;

pub struct MainWindow(WebviewWindow);

impl Deref for MainWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl MainWindow {
    pub const LABEL: &str = "main";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        if let Some(window) = app.get_webview_window(Self::LABEL) {
            let _ = window.set_focus();
            let _ = window.unminimize();
            return Ok(Self(window));
        }

        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, WebviewUrl::App("/".into())),
            app,
        )
        .title("Bfloat IDE")
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .visible(true)
        .inner_size(1920.0, 1080.0)
        .center()
        .initialization_script(format!(
            r#"
            window.__BFLOAT__ ??= {{}};
            window.__BFLOAT__.updaterEnabled = {UPDATER_ENABLED};
          "#
        ));

        let window = window_builder.build()?;

        // Ensure window is focused after creation (e.g., after update/relaunch)
        let _ = window.set_focus();

        setup_window_state_listener(app, &window);

        #[cfg(windows)]
        {
            use tauri_plugin_decorum::WebviewWindowExt;
            let _ = window.create_overlay_titlebar();
        }

        Ok(Self(window))
    }
}

fn setup_window_state_listener(app: &AppHandle, window: &WebviewWindow) {
    let (tx, mut rx) = mpsc::channel::<()>(1);

    window.on_window_event(move |event| {
        use tauri::WindowEvent;
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let _ = tx.try_send(());
    });

    tokio::spawn({
        let app = app.clone();

        async move {
            let save = || {
                let handle = app.clone();
                let app = app.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = app.save_window_state(window_state_flags());
                });
            };

            while rx.recv().await.is_some() {
                tokio::time::sleep(Duration::from_millis(200)).await;

                save();
            }
        }
    });
}

fn base_window_config<'a, R: Runtime, M: Manager<R>>(
    window_builder: WebviewWindowBuilder<'a, R, M>,
    _app: &AppHandle,
) -> WebviewWindowBuilder<'a, R, M> {
    let window_builder = window_builder.decorations(true);

    #[cfg(windows)]
    let window_builder = window_builder
        // Some VPNs set a global/system proxy that WebView2 applies even for loopback
        // connections, which breaks the app's localhost sidecar server.
        // Note: when setting additional args, we must re-apply wry's default
        // `--disable-features=...` flags.
        .additional_browser_args(
            "--proxy-bypass-list=<-loopback> --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        )
        .data_directory(
            _app.path()
                .config_dir()
                .expect("Failed to get config dir")
                .join(
                    _app.config()
                        .product_name
                        .clone()
                        .unwrap_or_else(|| "Bfloat".to_string()),
                ),
        )
        .decorations(false);

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

    window_builder
}
