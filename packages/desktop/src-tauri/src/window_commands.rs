use tauri::{AppHandle, Manager, window::Color};
use tauri_plugin_opener::OpenerExt;

use crate::windows::MainWindow;

fn get_main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window(MainWindow::LABEL)
        .ok_or_else(|| "Main window not found".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_minimize(app: AppHandle) -> Result<(), String> {
    get_main_window(&app)?
        .minimize()
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_maximize(app: AppHandle) -> Result<(), String> {
    get_main_window(&app)?
        .maximize()
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_close(app: AppHandle) -> Result<(), String> {
    get_main_window(&app)?
        .close()
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_maximize_toggle(app: AppHandle) -> Result<(), String> {
    let window = get_main_window(&app)?;
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn window_is_maximized(app: AppHandle) -> Result<bool, String> {
    get_main_window(&app)?
        .is_maximized()
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_is_fullscreen(app: AppHandle) -> Result<bool, String> {
    get_main_window(&app)?
        .is_fullscreen()
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_toggle_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = get_main_window(&app)?;
    let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    window
        .set_fullscreen(!is_fullscreen)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn window_set_background_color(app: AppHandle, color: String) -> Result<(), String> {
    // Parse a CSS hex color string (#RRGGBB or #RRGGBBAA) into a tauri::Color.
    // We accept both 6-digit and 8-digit hex forms; anything else is an error.
    let hex = color.trim_start_matches('#');
    let (r, g, b, a) = match hex.len() {
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).map_err(|e| e.to_string())?;
            let g = u8::from_str_radix(&hex[2..4], 16).map_err(|e| e.to_string())?;
            let b = u8::from_str_radix(&hex[4..6], 16).map_err(|e| e.to_string())?;
            (r, g, b, 255u8)
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).map_err(|e| e.to_string())?;
            let g = u8::from_str_radix(&hex[2..4], 16).map_err(|e| e.to_string())?;
            let b = u8::from_str_radix(&hex[4..6], 16).map_err(|e| e.to_string())?;
            let a = u8::from_str_radix(&hex[6..8], 16).map_err(|e| e.to_string())?;
            (r, g, b, a)
        }
        _ => {
            return Err(format!(
                "Invalid color format '{}'. Expected #RRGGBB or #RRGGBBAA",
                color
            ))
        }
    };

    get_main_window(&app)?
        .set_background_color(Some(Color(r, g, b, a)))
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}
