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
/** ライブラリの中の置き場所。characters はキャラクター、outfits は登録した衣装 */
const KINDS: [&str; 2] = ["characters", "outfits"];

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
    for kind in KINDS {
        fs::create_dir_all(dir.join(kind)).map_err(err)?;
    }
    Ok(dir)
}

/// キャラクターか衣装のフォルダー(kind は KINDS のどれか)
fn entry_dir(app: &AppHandle, kind: &str, id: &str) -> Result<PathBuf, String> {
    if !KINDS.contains(&kind) {
        return Err("invalid kind".into());
    }
    if !valid_id(id) {
        return Err("invalid id".into());
    }
    Ok(library_dir(app)?.join(kind).join(id))
}

fn character_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    entry_dir(app, "characters", id)
}

/// "sheets/xxx.png" のような、キャラクター(か衣装)のフォルダーの中の画像だけを許す
fn file_path(app: &AppHandle, kind: &str, id: &str, file: &str) -> Result<PathBuf, String> {
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
    Ok(entry_dir(app, kind, id)?.join(dir).join(name))
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
    character_dir(&app, &id)?;
    move_to_trash(&library_dir(&app)?, "characters", &id)
}

fn move_to_trash(library: &Path, kind: &str, id: &str) -> Result<(), String> {
    let dir = library.join(kind).join(id);
    if !dir.exists() {
        return Ok(());
    }
    let trash = library.join(".trash");
    fs::create_dir_all(&trash).map_err(err)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_secs();
    // 衣装は、キャラクターと見分けられるよう名前の頭に outfit- を付ける
    let prefix = if kind == "outfits" { "outfit-" } else { "" };
    fs::rename(&dir, trash.join(format!("{prefix}{id}-{stamp}"))).map_err(err)
}

// ---------------------------------------------------------------- 衣装

/// 登録した衣装の一覧(outfits/<id>/outfit.json の中身。新しい順)
#[tauri::command]
fn list_outfits(app: AppHandle) -> Result<Vec<Value>, String> {
    list_outfits_in(&library_dir(&app)?)
}

fn list_outfits_in(library: &Path) -> Result<Vec<Value>, String> {
    let mut list = Vec::new();
    let Ok(entries) = fs::read_dir(library.join("outfits")) else { return Ok(list) };
    for entry in entries.flatten() {
        let Ok(text) = fs::read_to_string(entry.path().join("outfit.json")) else { continue };
        if let Ok(o) = serde_json::from_str::<Value>(&text) {
            list.push(o);
        }
    }
    list.sort_by(|a, b| {
        let key = |v: &Value| v.get("updatedAt").and_then(Value::as_str).unwrap_or("").to_string();
        key(b).cmp(&key(a))
    });
    Ok(list)
}

#[tauri::command]
fn save_outfit(app: AppHandle, outfit: Value) -> Result<(), String> {
    let id = outfit.get("id").and_then(Value::as_str).ok_or("outfit id missing")?;
    let dir = entry_dir(&app, "outfits", id)?;
    fs::create_dir_all(&dir).map_err(err)?;
    write_json(&dir.join("outfit.json"), &outfit)
}

/// 消した衣装も .trash に移す
#[tauri::command]
fn delete_outfit(app: AppHandle, id: String) -> Result<(), String> {
    entry_dir(&app, "outfits", &id)?;
    move_to_trash(&library_dir(&app)?, "outfits", &id)
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
    // kind がなければキャラクター(0.1 のころの呼び方)
    let kind = header("kind").unwrap_or_else(|_| "characters".into());
    let path = file_path(&app, &kind, &header("id")?, &header("file")?)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(path, bytes).map_err(err)
}

#[tauri::command]
fn load_file(app: AppHandle, id: String, file: String, kind: Option<String>) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(file_path(&app, kind.as_deref().unwrap_or("characters"), &id, &file)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn delete_file(app: AppHandle, id: String, file: String, kind: Option<String>) -> Result<(), String> {
    let path = file_path(&app, kind.as_deref().unwrap_or("characters"), &id, &file)?;
    if path.exists() {
        fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- .euros(受け渡し用の zip)

/// 読み込めるキャラクターの形の版(src/types.ts の CHARACTER_SCHEMA_VERSION)
const SCHEMA_VERSION: u64 = 1;
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 5000;

/// zip の中の名前が、character.json か sheets/・refs/ の画像なら true
fn valid_entry(name: &str) -> bool {
    if name == "character.json" {
        return true;
    }
    let mut parts = name.split('/');
    let (Some(dir), Some(file), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    let Some((stem, ext)) = file.rsplit_once('.') else {
        return false;
    };
    FILE_DIRS.contains(&dir) && valid_id(stem) && FILE_EXTS.contains(&ext.to_ascii_lowercase().as_str())
}

/// キャラクターを1つの .euros にまとめる
#[tauri::command]
fn export_character(app: AppHandle, id: String, path: String) -> Result<(), String> {
    export_dir(&character_dir(&app, &id)?, Path::new(&path))
}

fn export_dir(dir: &Path, target: &Path) -> Result<(), String> {
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    let json = fs::read(dir.join("character.json")).map_err(err)?;
    let tmp = target.with_extension("euros.tmp");
    let mut zip = ZipWriter::new(fs::File::create(&tmp).map_err(err)?);
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    // 画像はすでに圧縮されているので、そのまま入れる
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let result = (|| -> Result<(), String> {
        zip.start_file("character.json", deflate).map_err(err)?;
        zip.write_all(&json).map_err(err)?;
        for sub in FILE_DIRS {
            let Ok(entries) = fs::read_dir(dir.join(sub)) else { continue };
            let mut names: Vec<String> = entries.flatten().filter_map(|e| e.file_name().into_string().ok()).collect();
            names.sort();
            for name in names {
                let entry = format!("{sub}/{name}");
                if !valid_entry(&entry) {
                    continue;
                }
                zip.start_file(entry, stored).map_err(err)?;
                zip.write_all(&fs::read(dir.join(sub).join(&name)).map_err(err)?).map_err(err)?;
            }
        }
        zip.finish().map_err(err)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    fs::rename(&tmp, target).map_err(err)
}

/// .euros を読み込む。
/// mode が null で同じ id のキャラクターがあれば、何もせず {status: "exists"} を返す。
/// "replace" は元のキャラクターを .trash に移して置き換え、"copy" は new_id の別のキャラクターにする
#[tauri::command]
fn import_character(app: AppHandle, path: String, mode: Option<String>, new_id: Option<String>) -> Result<Value, String> {
    import_into(&library_dir(&app)?, Path::new(&path), mode.as_deref(), new_id)
}

fn import_into(library: &Path, path: &Path, mode: Option<&str>, new_id: Option<String>) -> Result<Value, String> {
    use std::io::Read;

    let mut zip = zip::ZipArchive::new(fs::File::open(path).map_err(err)?).map_err(|_| "Euros のファイル(.euros)ではありません".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("ファイルの数が多すぎます".into());
    }

    // character.json を確かめる
    let mut character: Value = {
        let mut f = zip.by_name("character.json").map_err(|_| "character.json がありません".to_string())?;
        if f.size() > MAX_ENTRY_BYTES {
            return Err("character.json が大きすぎます".into());
        }
        let mut text = String::new();
        f.by_ref().take(MAX_ENTRY_BYTES).read_to_string(&mut text).map_err(err)?;
        serde_json::from_str(&text).map_err(|e| format!("character.json を読めません:{e}"))?
    };
    if character.get("app").and_then(Value::as_str) != Some("Euros") {
        return Err("Euros のキャラクターではありません".into());
    }
    let version = character.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0);
    if version == 0 || version > SCHEMA_VERSION {
        return Err(format!("新しい版の Euros で作られたキャラクターです(形式 v{version})。Euros を更新してください"));
    }
    let id = character.get("id").and_then(Value::as_str).filter(|s| valid_id(s)).ok_or("キャラクターの id が正しくありません")?.to_string();
    let name = character.pointer("/profile/name").cloned().unwrap_or(Value::Null);

    let root = library.join("characters");
    fs::create_dir_all(&root).map_err(err)?;
    let final_id = match mode {
        None if root.join(&id).exists() => return Ok(json!({ "status": "exists", "id": id, "name": name })),
        None | Some("replace") => id.clone(),
        Some("copy") => {
            let new_id = new_id.filter(|s| valid_id(s)).ok_or("新しい id が正しくありません")?;
            if root.join(&new_id).exists() {
                return Err("新しい id のキャラクターがすでにあります".into());
            }
            character["id"] = json!(new_id);
            // 一覧で元のキャラクターと見分けられるようにする
            if let Some(Value::String(n)) = character.pointer_mut("/profile/name") {
                n.push_str("(コピー)");
            }
            new_id
        }
        Some(m) => return Err(format!("unknown mode: {m}")),
    };

    // 一時フォルダーに展開してから、キャラクターのフォルダーにする
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_millis();
    // characters の外に置く(途中で止まっても、一覧に半端なキャラクターが出ないように)
    let tmp = library.join(".import").join(stamp.to_string());
    let result = (|| -> Result<(), String> {
        fs::create_dir_all(&tmp).map_err(err)?;
        let mut total = 0u64;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(err)?;
            let entry = f.name().map_err(err)?.to_string();
            if f.is_dir() || entry == "character.json" || !valid_entry(&entry) {
                continue;
            }
            if f.size() > MAX_ENTRY_BYTES {
                return Err(format!("{entry} が大きすぎます"));
            }
            let mut bytes = Vec::new();
            f.by_ref().take(MAX_ENTRY_BYTES + 1).read_to_end(&mut bytes).map_err(err)?;
            total += bytes.len() as u64;
            if bytes.len() as u64 > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES {
                return Err("ファイルが大きすぎます".into());
            }
            let (sub, file) = entry.split_once('/').ok_or("invalid entry")?;
            fs::create_dir_all(tmp.join(sub)).map_err(err)?;
            fs::write(tmp.join(sub).join(file), bytes).map_err(err)?;
        }
        write_json(&tmp.join("character.json"), &character)
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let dest = root.join(&final_id);
    if dest.exists() {
        // 置き換える前のキャラクターは .trash に残す
        if let Err(e) = move_to_trash(library, "characters", &final_id) {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    }
    fs::rename(&tmp, &dest).map_err(err)?;
    Ok(json!({ "status": "imported", "id": final_id, "name": name }))
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
            delete_file,
            export_character,
            import_character,
            list_outfits,
            save_outfit,
            delete_outfit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Euros");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("euros-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn make_character(library: &Path, id: &str) {
        let dir = library.join("characters").join(id);
        fs::create_dir_all(dir.join("sheets")).unwrap();
        fs::create_dir_all(dir.join("refs")).unwrap();
        let c = json!({ "schemaVersion": 1, "app": "Euros", "id": id, "profile": { "name": "しずく" }, "revisions": [{ "id": "r1", "image": "sheets/r1.png" }], "currentRevision": "r1" });
        fs::write(dir.join("character.json"), serde_json::to_string(&c).unwrap()).unwrap();
        fs::write(dir.join("sheets/r1.png"), [1u8, 2, 3]).unwrap();
        fs::write(dir.join("refs/a1.jpg"), [4u8, 5]).unwrap();
        fs::write(dir.join("refs/notes.txt"), "skip").unwrap();
    }

    #[test]
    fn export_and_import_round_trip() {
        let src = temp("src");
        let dst = temp("dst");
        make_character(&src, "c1");
        let file = src.join("c1.euros");
        export_dir(&src.join("characters/c1"), &file).unwrap();

        // 新しいライブラリにはそのまま入る
        let r = import_into(&dst, &file, None, None).unwrap();
        assert_eq!(r["status"], "imported");
        let dir = dst.join("characters/c1");
        assert_eq!(fs::read(dir.join("sheets/r1.png")).unwrap(), [1, 2, 3]);
        assert_eq!(fs::read(dir.join("refs/a1.jpg")).unwrap(), [4, 5]);
        assert!(!dir.join("refs/notes.txt").exists());

        // 同じ id があれば聞き返す
        assert_eq!(import_into(&dst, &file, None, None).unwrap()["status"], "exists");

        // 別のキャラクターにする
        let r = import_into(&dst, &file, Some("copy"), Some("c2".into())).unwrap();
        assert_eq!(r["id"], "c2");
        let c: Value = serde_json::from_str(&fs::read_to_string(dst.join("characters/c2/character.json")).unwrap()).unwrap();
        assert_eq!(c["id"], "c2");
        assert_eq!(c["profile"]["name"], "しずく(コピー)");

        // 置き換えると、元は .trash に移る
        fs::write(dir.join("sheets/r1.png"), [9u8]).unwrap();
        import_into(&dst, &file, Some("replace"), None).unwrap();
        assert_eq!(fs::read(dir.join("sheets/r1.png")).unwrap(), [1, 2, 3]);
        assert_eq!(fs::read_dir(dst.join(".trash")).unwrap().count(), 1);
    }

    #[test]
    fn lists_outfits_newest_first_and_trashes_them() {
        let lib = temp("outfits");
        for (id, at) in [("o1", "2026-01-01"), ("o2", "2026-02-01")] {
            let dir = lib.join("outfits").join(id);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("outfit.json"), json!({ "id": id, "updatedAt": at }).to_string()).unwrap();
        }
        // 壊れた衣装は飛ばす
        fs::create_dir_all(lib.join("outfits/bad")).unwrap();
        fs::write(lib.join("outfits/bad/outfit.json"), "{").unwrap();
        let ids: Vec<Value> = list_outfits_in(&lib).unwrap().iter().map(|o| o["id"].clone()).collect();
        assert_eq!(ids, [json!("o2"), json!("o1")]);

        move_to_trash(&lib, "outfits", "o1").unwrap();
        assert!(!lib.join("outfits/o1").exists());
        let trashed: Vec<String> = fs::read_dir(lib.join(".trash")).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        assert!(trashed[0].starts_with("outfit-o1-"));
    }

    #[test]
    fn rejects_bad_entries_and_newer_versions() {
        use std::io::Write;
        let lib = temp("bad");
        let file = lib.join("bad.euros");
        let mut zip = zip::ZipWriter::new(fs::File::create(&file).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        zip.start_file("character.json", o).unwrap();
        zip.write_all(br#"{"schemaVersion":1,"app":"Euros","id":"c1"}"#).unwrap();
        zip.start_file("../evil.png", o).unwrap();
        zip.write_all(b"x").unwrap();
        zip.start_file("sheets/../../evil.png", o).unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();
        import_into(&lib, &file, None, None).unwrap();
        assert!(!lib.join("evil.png").exists());
        assert!(!lib.join("characters/evil.png").exists());

        let file2 = lib.join("new.euros");
        let mut zip = zip::ZipWriter::new(fs::File::create(&file2).unwrap());
        zip.start_file("character.json", o).unwrap();
        zip.write_all(br#"{"schemaVersion":2,"app":"Euros","id":"c9"}"#).unwrap();
        zip.finish().unwrap();
        assert!(import_into(&lib, &file2, None, None).is_err());
        assert!(import_into(&lib, &lib.join("missing.euros"), None, None).is_err());
    }
}
