//! Data folder, lock file and backups. The rules live in src/datarules.ts; these are the file operations
//! the webview can't do. ponytail: paths come from the webview, which can already read and write any file through
//! the sql plugin (`VACUUM INTO`, `ATTACH`), so they are not scoped here either.
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const DB: &str = "sprigo.db";
const LOCK: &str = "sprigo.lock";
const POINTER: &str = "location.json";

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// "Özer's MacBook Pro" on macOS, the host name elsewhere.
fn device_name() -> &'static str {
    static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        let run = |cmd: &str, args: &[&str]| {
            let out = std::process::Command::new(cmd).args(args).output().ok()?;
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (out.status.success() && !s.is_empty()).then_some(s)
        };
        #[cfg(target_os = "macos")]
        let name = run("scutil", &["--get", "ComputerName"]).or_else(|| run("hostname", &[]));
        #[cfg(not(target_os = "macos"))]
        let name = run("hostname", &[]);
        name.unwrap_or_else(|| "?".into())
    })
}

// ---- Location ----

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    data_dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    data_dir: String,
    default_dir: String,
    device: String,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(err)
}

/// `location.json` in the app config dir points at the data folder; without it the config dir itself is used
/// (where sprigo.db always lived), so existing installs see no change.
#[tauri::command]
pub fn data_location(app: tauri::AppHandle) -> Result<Location, String> {
    let default = config_dir(&app)?;
    std::fs::create_dir_all(&default).map_err(err)?;
    let custom = std::fs::read_to_string(default.join(POINTER)).ok()
        .and_then(|s| serde_json::from_str::<Pointer>(&s).ok())
        .map(|p| p.data_dir)
        .filter(|d| Path::new(d).is_absolute());
    let default = default.to_string_lossy().into_owned();
    Ok(Location { data_dir: custom.unwrap_or_else(|| default.clone()), default_dir: default, device: device_name().into() })
}

/// `None` goes back to the default folder.
#[tauri::command]
pub fn set_data_dir(app: tauri::AppHandle, dir: Option<String>) -> Result<(), String> {
    let file = config_dir(&app)?.join(POINTER);
    match dir {
        Some(d) if Path::new(&d).is_absolute() => {
            std::fs::write(file, serde_json::to_string(&Pointer { data_dir: d }).map_err(err)?).map_err(err)
        }
        Some(d) => Err(format!("not an absolute path: {d}")),
        None => match std::fs::remove_file(file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
            _ => Ok(()),
        },
    }
}

/// The folder is there (an unplugged SSD or an offline cloud folder is not).
#[tauri::command]
pub fn dir_ok(dir: String) -> bool {
    std::fs::read_dir(&dir).is_ok()
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

// ---- Lock ----

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Lock {
    device: String,
    at: u64,
}

/// The folder this process holds the lock in, so it can be released on exit.
static HELD: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// A missing or unreadable lock (e.g. half-synced by a cloud client) counts as none.
#[tauri::command]
pub fn lock_read(dir: String) -> Option<Lock> {
    serde_json::from_str(&std::fs::read_to_string(Path::new(&dir).join(LOCK)).ok()?).ok()
}

/// Claims or refreshes the lock. Written to a temp file and renamed, so sync clients never see half a file.
#[tauri::command]
pub fn lock_write(dir: String) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    let tmp = dir.join(format!("{LOCK}.tmp"));
    let body = serde_json::to_string(&Lock { device: device_name().into(), at: now_ms() }).map_err(err)?;
    std::fs::write(&tmp, body).map_err(err)?;
    std::fs::rename(&tmp, dir.join(LOCK)).map_err(err)?;
    *HELD.lock().map_err(err)? = Some(dir);
    Ok(())
}

/// Removes the lock only if it is still ours (another device may have taken over).
#[tauri::command]
pub fn lock_remove(dir: String) {
    if lock_read(dir.clone()).is_some_and(|l| l.device == device_name()) {
        let _ = std::fs::remove_file(Path::new(&dir).join(LOCK));
    }
    if let Ok(mut held) = HELD.lock() {
        if held.as_deref() == Some(Path::new(&dir)) {
            held.take();
        }
    }
}

/// On app exit.
pub fn release_lock() {
    let dir = HELD.lock().ok().and_then(|mut h| h.take());
    if let Some(d) = dir {
        lock_remove(d.to_string_lossy().into_owned());
    }
}

// ---- Backups and files ----

/// File names in `<dir>/backups`, creating the folder so `VACUUM INTO` can write there.
#[tauri::command]
pub fn backups_list(dir: String) -> Result<Vec<String>, String> {
    let b = Path::new(&dir).join("backups");
    std::fs::create_dir_all(&b).map_err(err)?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(&b).map_err(err)? {
        out.push(e.map_err(err)?.file_name().to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Deletes one file directly inside `<dir>/backups`.
#[tauri::command]
pub fn backups_remove(dir: String, name: String) -> Result<(), String> {
    if name.is_empty() || name.starts_with('.') || name.contains(['/', '\\']) {
        return Err(format!("bad backup name: {name}"));
    }
    std::fs::remove_file(Path::new(&dir).join("backups").join(name)).map_err(err)
}

#[tauri::command]
pub fn copy_file(from: String, to: String) -> Result<(), String> {
    std::fs::copy(from, to).map(|_| ()).map_err(err)
}

/// Writes a text file the learner picked in a save dialog (word list CSV, #24).
#[tauri::command]
pub fn write_text(path: String, text: String) -> Result<(), String> {
    std::fs::write(path, text).map_err(err)
}

/// Only SQLite files can be imported.
#[tauri::command]
pub fn is_sqlite(path: String) -> bool {
    use std::io::Read;
    let mut head = [0u8; 16];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == b"SQLite format 3\0"
}

/// Puts `src` in place as `<dir>/sprigo.db`. Whatever was there (with its -wal/-shm) moves to
/// `<dir>/backups/replaced-<ms>.db*` first; nothing is deleted. The database must be closed.
#[tauri::command]
pub fn install_db(src: String, dir: String) -> Result<(), String> {
    if !is_sqlite(src.clone()) {
        return Err("not a SQLite database".into());
    }
    let dir = PathBuf::from(dir);
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups).map_err(err)?;
    let part = dir.join(format!("{DB}.part"));
    std::fs::copy(&src, &part).map_err(err)?;
    let stamp = now_ms();
    for suffix in ["", "-wal", "-shm"] {
        let old = dir.join(format!("{DB}{suffix}"));
        if old.exists() {
            std::fs::rename(&old, backups.join(format!("replaced-{stamp}.db{suffix}"))).map_err(err)?;
        }
    }
    std::fs::rename(&part, dir.join(DB)).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sprigo-data-test-{name}-{}", now_ms()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn install_db_moves_the_old_file_aside() {
        let dir = temp("install");
        let src = dir.join("new.db");
        std::fs::write(&src, b"SQLite format 3\0new").unwrap();
        std::fs::write(dir.join(DB), b"SQLite format 3\0old").unwrap();
        std::fs::write(dir.join(format!("{DB}-wal")), b"wal").unwrap();
        install_db(s(&src), s(&dir)).unwrap();
        assert_eq!(std::fs::read(dir.join(DB)).unwrap(), b"SQLite format 3\0new");
        assert!(!dir.join(format!("{DB}-wal")).exists());
        let mut kept = backups_list(s(&dir)).unwrap();
        kept.sort();
        assert_eq!(kept.len(), 2);
        assert!(kept[0].starts_with("replaced-") && kept[0].ends_with(".db"));
        assert!(kept[1].ends_with(".db-wal"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn install_db_rejects_non_sqlite_and_keeps_the_old_file() {
        let dir = temp("reject");
        let src = dir.join("notes.txt");
        std::fs::write(&src, b"hello").unwrap();
        std::fs::write(dir.join(DB), b"SQLite format 3\0old").unwrap();
        assert!(install_db(s(&src), s(&dir)).is_err());
        assert_eq!(std::fs::read(dir.join(DB)).unwrap(), b"SQLite format 3\0old");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lock_round_trip_and_foreign_lock_survives_remove() {
        let dir = temp("lock");
        assert!(lock_read(s(&dir)).is_none());
        lock_write(s(&dir)).unwrap();
        assert_eq!(lock_read(s(&dir)).unwrap().device, device_name());
        lock_remove(s(&dir));
        assert!(lock_read(s(&dir)).is_none());
        std::fs::write(dir.join(LOCK), r#"{"device":"other-mac","at":1}"#).unwrap();
        lock_remove(s(&dir));
        assert_eq!(lock_read(s(&dir)).unwrap().device, "other-mac");
        assert!(backups_remove(s(&dir), "../sprigo.lock".into()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
