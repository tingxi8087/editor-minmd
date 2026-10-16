use crate::{read_document, workspace, DocumentFile, OpenedFiles};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Default)]
pub struct SessionIo(Mutex<()>);
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionTab {
    path: String,
    mode: String,
    reading: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    version: u8,
    directory: Option<String>,
    tabs: Vec<SessionTab>,
    active_path: Option<String>,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            version: 1,
            directory: None,
            tabs: vec![],
            active_path: None,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredTab {
    file: DocumentFile,
    mode: String,
    reading: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSession {
    exists: bool,
    session: Session,
    root: Option<workspace::DirectoryRoot>,
    tabs: Vec<RestoredTab>,
    errors: Vec<String>,
}
fn storage(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workspace-session.json"))
}
fn validate(session: &Session) -> Result<(), String> {
    let valid_path = |p: &str| Path::new(p).is_absolute() && p.len() <= 16384 && !p.contains('\0');
    let mut seen = HashSet::new();
    if session.version != 1
        || session.tabs.len() > 128
        || session.directory.as_ref().is_some_and(|p| !valid_path(p))
        || session.tabs.iter().any(|t| {
            !valid_path(&t.path)
                || !seen.insert(&t.path)
                || !["document", "source"].contains(&t.mode.as_str())
        })
        || session
            .active_path
            .as_ref()
            .is_some_and(|p| !session.tabs.iter().any(|t| &t.path == p))
    {
        return Err("工作区恢复记录格式无效或版本不兼容，原记录已保留".into());
    }
    Ok(())
}
fn load(path: &Path) -> Result<Option<Session>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("无法读取工作区恢复记录：{e}")),
    };
    let mut bytes = Vec::new();
    file.take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("工作区恢复记录过大，原记录已保留".into());
    }
    let session: Session =
        serde_json::from_slice(&bytes).map_err(|_| "工作区恢复记录损坏，原记录已保留")?;
    validate(&session)?;
    Ok(Some(session))
}
fn write(path: &Path, session: &Session) -> Result<(), String> {
    validate(session)?;
    let parent = path.parent().ok_or("工作区存储路径无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temporary, session).map_err(|e| e.to_string())?;
    temporary.flush().map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist(path)
        .map_err(|e| format!("无法保存工作区恢复记录，原记录未替换：{e}"))?;
    Ok(())
}
fn unchanged_path(path: &str, directory: bool) -> Result<PathBuf, String> {
    let resolved = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("{path}：{e}"))?;
    if resolved != Path::new(path)
        || if directory {
            !resolved.is_dir()
        } else {
            !resolved.is_file()
        }
    {
        return Err(format!("{path}：位置或类型已变化，未自动打开"));
    }
    Ok(resolved)
}
#[tauri::command]
pub async fn restore_workspace_session(
    app: tauri::AppHandle,
    restore_directory: bool,
) -> Result<RestoredSession, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<SessionIo>();
        let _guard = io.0.lock().map_err(|e| e.to_string())?;
        let saved = load(&storage(&app)?)?;
        let exists = saved.is_some();
        let session = saved.unwrap_or_default();
        let mut result = RestoredSession {
            exists,
            session: session.clone(),
            root: None,
            tabs: vec![],
            errors: vec![],
        };
        if let Some(path) = session.directory.as_ref().filter(|_| restore_directory) {
            match unchanged_path(path, true)
                .and_then(|p| workspace::open_recorded_directory(&app, p))
            {
                Ok(root) => result.root = Some(root),
                Err(e) => result.errors.push(format!("目录恢复失败：{e}")),
            }
        }
        for tab in session.tabs {
            match unchanged_path(&tab.path, false).and_then(|p| read_document(&p)) {
                Ok(file) => {
                    app.state::<OpenedFiles>()
                        .0
                        .lock()
                        .map_err(|e| e.to_string())?
                        .insert(PathBuf::from(&file.path));
                    result.tabs.push(RestoredTab {
                        file,
                        mode: tab.mode,
                        reading: tab.reading,
                    });
                }
                Err(e) => result.errors.push(format!("文件恢复失败：{e}")),
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn write_workspace_session(
    app: tauri::AppHandle,
    session: Session,
    reset: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<SessionIo>();
        let _guard = io.0.lock().map_err(|e| e.to_string())?;
        validate(&session)?;
        let path = storage(&app)?;
        if !reset {
            load(&path)?;
        }
        let root = app.state::<workspace::WorkspaceRoot>();
        let root = root.0.lock().map_err(|e| e.to_string())?;
        if session
            .directory
            .as_ref()
            .is_some_and(|p| root.as_deref() != Some(Path::new(p)))
        {
            return Err("只能记住当前工作目录".into());
        }
        let opened = app.state::<OpenedFiles>();
        let opened = opened.0.lock().map_err(|e| e.to_string())?;
        if session
            .tabs
            .iter()
            .any(|t| !opened.contains(Path::new(&t.path)))
        {
            return Err("只能记住已打开或已保存的文件".into());
        }
        write(&path, &session)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sample(path: &str) -> Session {
        Session {
            tabs: vec![SessionTab {
                path: path.into(),
                mode: "source".into(),
                reading: false,
            }],
            active_path: Some(path.into()),
            ..Session::default()
        }
    }
    #[test]
    fn round_trip_unicode_order_and_active() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app/session.json");
        assert_eq!(load(&path).unwrap(), None);
        let mut data = sample("/中文 空格/a.md");
        data.directory = Some("/中文 空格".into());
        data.tabs.push(SessionTab {
            path: "/b.ts".into(),
            mode: "source".into(),
            reading: false,
        });
        write(&path, &data).unwrap();
        assert_eq!(load(&path).unwrap(), Some(data));
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn rejects_invalid_version_paths_duplicates_and_active() {
        for data in [
            sample("relative.md"),
            Session {
                version: 2,
                ..sample("/a")
            },
            Session {
                active_path: Some("/missing".into()),
                ..sample("/a")
            },
            Session {
                tabs: vec![SessionTab {
                    path: "/a".into(),
                    mode: "bad".into(),
                    reading: false,
                }],
                ..Session::default()
            },
        ] {
            assert!(validate(&data).is_err());
        }
        let mut data = sample("/a");
        data.tabs.push(data.tabs[0].clone());
        assert!(validate(&data).is_err());
        data.tabs = (0..129)
            .map(|n| SessionTab {
                path: format!("/{n}"),
                mode: "source".into(),
                reading: false,
            })
            .collect();
        assert!(validate(&data).is_err());
    }
    #[test]
    fn corrupt_and_oversize_libraries_remain_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        for bytes in [b"{broken".to_vec(), vec![b' '; 2 * 1024 * 1024 + 1]] {
            fs::write(&path, &bytes).unwrap();
            assert!(load(&path).is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn missing_or_replaced_paths_are_rejected() {
        let dir = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let path = dir.path().join("中文.md");
        fs::write(&path, "# A").unwrap();
        assert!(unchanged_path(path.to_str().unwrap(), false).is_ok());
        assert!(unchanged_path(path.to_str().unwrap(), true).is_err());
        fs::remove_file(&path).unwrap();
        assert!(unchanged_path(path.to_str().unwrap(), false).is_err());
        #[cfg(unix)]
        {
            let target = dir.path().join("target.md");
            fs::write(&target, "private").unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            assert!(unchanged_path(path.to_str().unwrap(), false).is_err());
        }
    }
    #[test]
    fn failed_atomic_write_keeps_existing_library() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blocked");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("keep"), "original").unwrap();
        assert!(write(&path, &Session::default()).is_err());
        assert_eq!(fs::read_to_string(path.join("keep")).unwrap(), "original");
    }
}
