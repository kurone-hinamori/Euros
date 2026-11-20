use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// 画像として保存できるファイルの置き場所(キャラクターのフォルダーの中)
const FILE_DIRS: [&str; 2] = ["sheets", "refs"];
const FILE_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ---------------------------------------------------------------- 設定

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> Result<Value, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let text = fs::read_to_string(path).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

/// 設定。まだファイルがなければ null(WebView の localStorage は壊れて消えることがあるため、ファイルにする)
#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Value, String> {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    write_json(&settings_path(&app)?, &settings)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(err)?;
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

// ---------------------------------------------------------------- ライブラリ

/// 既定のライブラリ。ほかのアプリ(Notos など)からも探しやすいよう、%APPDATA%\Euros\library に固定する
fn default_library(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().data_dir().map_err(err)?.join("Euros").join("library"))
}

/// 設定で選んだライブラリ。未設定なら既定の場所
fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let chosen = read_settings(app)?
        .get("libraryDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let dir = match chosen {
        Some(d) => d,
        None => default_library(app)?,
    };
    fs::create_dir_all(dir.join("characters")).map_err(err)?;
    Ok(dir)
}

fn character_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid character id".into());
    }
    Ok(library_dir(app)?.join("characters").join(id))
}

/// "sheets/xxx.png" のような、キャラクターのフォルダーの中の画像だけを許す
fn file_path(app: &AppHandle, id: &str, file: &str) -> Result<PathBuf, String> {
    let mut parts = file.split('/');
    let (Some(dir), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err("invalid file path".into());
    };
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return Err("invalid file name".into());
    };
    if !FILE_DIRS.contains(&dir) || !valid_id(stem) || !FILE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
        return Err("invalid file path".into());
    }
    Ok(character_dir(app, id)?.join(dir).join(name))
}

#[tauri::command]
fn library_info(app: AppHandle) -> Result<Value, String> {
    Ok(json!({
        "path": library_dir(&app)?.to_string_lossy(),
        "defaultPath": default_library(&app)?.to_string_lossy(),
    }))
}

#[tauri::command]
fn open_library(app: AppHandle) -> Result<(), String> {
    let dir = library_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(err)
}

/// 一覧に出す分だけを取り出す
fn summarize(c: &Value) -> Value {
    let current = c.get("currentRevision").and_then(Value::as_str);
    let sheet = c
        .get("revisions")
        .and_then(Value::as_array)
        .and_then(|revs| revs.iter().find(|r| r.get("id").and_then(Value::as_str) == current))
        .and_then(|r| r.get("image"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "id": c.get("id"),
        "name": c.pointer("/profile/name"),
        "reading": c.pointer("/profile/reading"),
        "createdAt": c.get("createdAt"),
        "updatedAt": c.get("updatedAt"),
        "revisionCount": c.get("revisions").and_then(Value::as_array).map_or(0, Vec::len),
        "sheet": sheet,
    })
}

#[tauri::command]
fn list_characters(app: AppHandle) -> Result<Vec<Value>, String> {
    let root = library_dir(&app)?.join("characters");
    let mut list = Vec::new();
    for entry in fs::read_dir(root).map_err(err)?.flatten() {
        let path = entry.path().join("character.json");
        let Ok(text) = fs::read_to_string(&path) else { continue };
        // 壊れたファイルは一覧から外す(ほかのキャラクターは読めるようにする)
        if let Ok(c) = serde_json::from_str::<Value>(&text) {
            list.push(summarize(&c));
        }
    }
    list.sort_by(|a, b| {
        let key = |v: &Value| v.get("updatedAt").and_then(Value::as_str).unwrap_or("").to_string();
        key(b).cmp(&key(a))
    });
    Ok(list)
}

#[tauri::command]
fn load_character(app: AppHandle, id: String) -> Result<Value, String> {
    let text = fs::read_to_string(character_dir(&app, &id)?.join("character.json")).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

#[tauri::command]
fn save_character(app: AppHandle, character: Value) -> Result<(), String> {
    let id = character
        .get("id")
        .and_then(Value::as_str)
        .ok_or("character id missing")?;
    let dir = character_dir(&app, id)?;
    fs::create_dir_all(&dir).map_err(err)?;
    write_json(&dir.join("character.json"), &character)
}

/// 消したキャラクターは、すぐには消さずライブラリの .trash に移す
#[tauri::command]
fn delete_character(app: AppHandle, id: String) -> Result<(), String> {
    let dir = character_dir(&app, &id)?;
    if !dir.exists() {
        return Ok(());
    }
    let trash = library_dir(&app)?.join(".trash");
    fs::create_dir_all(&trash).map_err(err)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs();
    fs::rename(&dir, trash.join(format!("{id}-{stamp}"))).map_err(err)
}

/// 画像の中身をそのまま受け取る(id と file はヘッダーで渡す)
#[tauri::command]
fn save_file(app: AppHandle, request: tauri::ipc::Request) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| format!("missing {name}"))
    };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("file bytes expected".into());
    };
    let path = file_path(&app, &header("id")?, &header("file")?)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(path, bytes).map_err(err)
}

#[tauri::command]
fn load_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(file_path(&app, &id, &file)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn delete_file(app: AppHandle, id: String, file: String) -> Result<(), String> {
    let path = file_path(&app, &id, &file)?;
    if path.exists() {
        fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    // ウィンドウの位置とサイズは、終了時に保存して次回の起動時に復元する
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            library_info,
            open_library,
            list_characters,
            load_character,
            save_character,
            delete_character,
            save_file,
            load_file,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Euros");
}
