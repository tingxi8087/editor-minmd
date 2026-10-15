use super::{read_document, OpenedFiles};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

const MAX_STORE: u64 = 128 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    id: String,
    name: String,
    path: Option<String>,
    resource_base: Option<String>,
    #[serde(default)]
    document: Option<serde_json::Value>,
    #[serde(default)]
    baseline: Option<serde_json::Value>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    authority: Option<String>,
    #[serde(default)]
    source_scroll_top: Option<f64>,
    raw: String,
    content: String,
    updated_at: f64,
    scroll_top: f64,
    selection: usize,
}
#[derive(Serialize, Deserialize)]
struct DraftStore {
    version: u32,
    drafts: Vec<Draft>,
}
#[derive(Default)]
pub struct RecoveryLock(Mutex<()>);
fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery-v1.json"))
}
fn validate(drafts: &[Draft]) -> Result<(), String> {
    let mut ids = HashSet::new();
    if drafts.len() > 512 {
        return Err("恢复草稿超过 512 份，未写入".into());
    }
    for draft in drafts {
        if draft.id.is_empty()
            || draft.id.len() > 128
            || !ids.insert(&draft.id)
            || draft.content.len() > 32 * 1024 * 1024
            || draft.raw.len() > 16 * 1024 * 1024
            || !draft.scroll_top.is_finite()
            || !draft.updated_at.is_finite()
        {
            return Err("草稿格式或大小无效，原恢复文件保留".into());
        }
        if draft
            .kind
            .as_deref()
            .is_some_and(|v| !matches!(v, "markdown" | "text"))
            || draft
                .mode
                .as_deref()
                .is_some_and(|v| !matches!(v, "document" | "source"))
            || draft
                .authority
                .as_deref()
                .is_some_and(|v| !matches!(v, "rich" | "source"))
            || draft.source_scroll_top.is_some_and(|v| !v.is_finite())
        {
            return Err("草稿模式无效，原恢复文件保留".into());
        }
        for value in [&draft.document, &draft.baseline].into_iter().flatten() {
            if value.get("type").and_then(|t| t.as_str()) != Some("doc") {
                return Err("草稿正文结构无效，原恢复文件保留".into());
            }
        }
        for path in [&draft.path, &draft.resource_base].into_iter().flatten() {
            if !Path::new(path).is_absolute() {
                return Err("草稿文件路径必须是绝对路径".into());
            }
        }
    }
    Ok(())
}
fn read_store(path: &Path) -> Result<Vec<Draft>, String> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("无法读取恢复草稿：{e}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_STORE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_STORE {
        return Err("恢复文件超过 128 MB，已保留原文件".into());
    }
    let store: DraftStore =
        serde_json::from_slice(&bytes).map_err(|e| format!("恢复文件损坏，已保留原文件：{e}"))?;
    if store.version != 1 {
        return Err("无法识别恢复文件版本，已保留原文件".into());
    }
    validate(&store.drafts)?;
    Ok(store.drafts)
}
fn write_store(path: &Path, drafts: Vec<Draft>) -> Result<(), String> {
    validate(&drafts)?;
    let bytes =
        serde_json::to_vec(&DraftStore { version: 1, drafts }).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_STORE {
        return Err("草稿总量超过 128 MB，未更新恢复文件".into());
    }
    let parent = path.parent().ok_or("恢复目录无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建恢复目录：{e}"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(&bytes)
        .map_err(|e| format!("草稿写入失败：{e}"))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("草稿同步失败：{e}"))?;
    temp.persist(path)
        .map_err(|e| format!("草稿替换失败：{e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn load_drafts(app: tauri::AppHandle) -> Result<Vec<Draft>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<RecoveryLock>();
        let _lock = guard.0.lock().map_err(|e| e.to_string())?;
        read_store(&store_path(&app)?)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn write_drafts(app: tauri::AppHandle, drafts: Vec<Draft>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<RecoveryLock>();
        let _lock = guard.0.lock().map_err(|e| e.to_string())?;
        write_store(&store_path(&app)?, drafts)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSnapshot {
    path: String,
    kind: &'static str,
    content: Option<String>,
    message: Option<String>,
}
fn snapshot(path: &Path) -> DiskSnapshot {
    let name = path.to_string_lossy().into_owned();
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => DiskSnapshot {
            path: name,
            kind: "missing",
            content: None,
            message: Some("文件已被删除或移动".into()),
        },
        Err(e) => DiskSnapshot {
            path: name,
            kind: "error",
            content: None,
            message: Some(format!("文件无法读取：{e}")),
        },
        Ok(_) => match read_document(path) {
            Ok(file) => DiskSnapshot {
                path: name,
                kind: "present",
                content: Some(file.content),
                message: None,
            },
            Err(e) => DiskSnapshot {
                path: name,
                kind: "error",
                content: None,
                message: Some(e),
            },
        },
    }
}
fn check_authorized(files: &OpenedFiles, paths: &[String]) -> Result<(), String> {
    let opened = files.0.lock().map_err(|e| e.to_string())?;
    if paths.iter().any(|path| !opened.contains(Path::new(path))) {
        return Err("只能检查已打开的文档".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn check_documents(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<DiskSnapshot>, String> {
    check_authorized(&app.state::<OpenedFiles>(), &paths)?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(paths.iter().map(|path| snapshot(Path::new(path))).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn authorize_draft(
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<DiskSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = app.state::<RecoveryLock>();
        let _lock = guard.0.lock().map_err(|e| e.to_string())?;
        let draft = read_store(&store_path(&app)?)?
            .into_iter()
            .find(|d| d.id == id)
            .ok_or("恢复草稿已不存在，请重新启动后检查")?;
        let files = app.state::<OpenedFiles>();
        let mut opened = files.0.lock().map_err(|e| e.to_string())?;
        for path in [&draft.path, &draft.resource_base].into_iter().flatten() {
            opened.insert(PathBuf::from(path));
        }
        Ok(draft.path.map(|path| snapshot(Path::new(&path))))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Default)]
pub struct DocumentWatcher(Mutex<Option<RecommendedWatcher>>);
fn create_watcher<F: FnMut(notify::Result<notify::Event>) + Send + 'static>(
    paths: &[String],
    callback: F,
) -> Result<RecommendedWatcher, String> {
    let mut watcher = notify::recommended_watcher(callback).map_err(|e| e.to_string())?;
    let parents: HashSet<_> = paths
        .iter()
        .filter_map(|path| Path::new(path).parent())
        .collect();
    for parent in parents {
        watcher
            .watch(parent, RecursiveMode::NonRecursive)
            .map_err(|e| format!("无法监听 {}：{e}", parent.display()))?;
    }
    Ok(watcher)
}
#[tauri::command]
pub fn watch_documents(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    check_authorized(&app.state::<OpenedFiles>(), &paths)?;
    let emitter = app.clone();
    let watcher = if paths.is_empty() {
        None
    } else {
        Some(create_watcher(&paths, move |event| {
            // Access notifications are generated by our own reads and must not cause a feedback loop.
            if !matches!(event, Ok(ref event) if matches!(event.kind, notify::EventKind::Access(_)))
            {
                let _ = emitter.emit("document-disk-change", ());
            }
        })?)
    };
    *app.state::<DocumentWatcher>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = watcher;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> Draft {
        Draft {
            id: "draft-1".into(),
            name: "未命名.md".into(),
            path: None,
            resource_base: None,
            kind: None,
            mode: None,
            authority: None,
            source_scroll_top: None,
            document: None,
            baseline: None,
            raw: "".into(),
            content: "# 中文草稿\n\n未保存".into(),
            updated_at: 1.0,
            scroll_top: 42.0,
            selection: 3,
        }
    }
    #[test]
    fn recovery_roundtrip_and_pruning_do_not_write_original_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data/recovery.json");
        let original = dir.path().join("中文.md");
        fs::write(&original, "磁盘原文").unwrap();
        let mut d = draft();
        d.path = Some(original.to_string_lossy().into_owned());
        write_store(&path, vec![d]).unwrap();
        let loaded = read_store(&path).unwrap();
        assert_eq!(loaded[0].content, "# 中文草稿\n\n未保存");
        assert_eq!(loaded[0].scroll_top, 42.0);
        assert_eq!(fs::read_to_string(&original).unwrap(), "磁盘原文");
        write_store(&path, vec![]).unwrap();
        assert!(read_store(&path).unwrap().is_empty());
    }
    #[test]
    fn corrupt_unknown_and_invalid_stores_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.json");
        assert!(read_store(&path).unwrap().is_empty());
        for content in ["{broken", "{\"version\":99,\"drafts\":[]}"] {
            fs::write(&path, content).unwrap();
            assert!(read_store(&path).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
        let mut d = draft();
        d.path = Some("relative.md".into());
        assert!(write_store(&path, vec![d]).is_err());
        assert!(write_store(&path, vec![draft(), draft()]).is_err());
    }
    #[test]
    fn structured_snapshots_roundtrip_and_invalid_updates_preserve_last_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.json");
        let mut d = draft();
        d.document = Some(
            serde_json::json!({"type":"doc","content":[{"type":"heading","attrs":{"level":2}},{"type":"paragraph","content":[{"type":"text","text":"结构草稿"}]}]}),
        );
        d.baseline = Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph"}]}));
        write_store(&path, vec![d.clone()]).unwrap();
        assert_eq!(read_store(&path).unwrap()[0].document, d.document);
        let before = fs::read(&path).unwrap();
        d.document = Some(serde_json::json!({"type":"unknown"}));
        assert!(write_store(&path, vec![d]).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let blocked = dir.path().join("blocked");
        fs::write(&blocked, "file, not directory").unwrap();
        assert!(write_store(&blocked.join("recovery.json"), vec![draft()]).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }
    #[test]
    fn snapshot_distinguishes_changes_missing_and_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文.md");
        assert_eq!(snapshot(&path).kind, "missing");
        fs::write(&path, "外部修改").unwrap();
        assert_eq!(snapshot(&path).content.as_deref(), Some("外部修改"));
        fs::write(&path, [255, 254]).unwrap();
        assert_eq!(snapshot(&path).kind, "error");
        assert!(check_authorized(
            &OpenedFiles::default(),
            &[path.to_string_lossy().into_owned()]
        )
        .is_err());
    }
    #[test]
    fn native_watcher_survives_atomic_replacement_delete_and_recreate() {
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文.md");
        fs::write(&path, "initial").unwrap();
        let (tx, rx) = mpsc::channel();
        let _watcher = create_watcher(&[path.to_string_lossy().into_owned()], move |event| {
            if matches!(event, Ok(ref e) if !matches!(e.kind, notify::EventKind::Access(_))) {
                let _ = tx.send(());
            }
        })
        .unwrap();
        let wait = || {
            let until = Instant::now() + Duration::from_secs(5);
            loop {
                if rx
                    .recv_timeout(until.saturating_duration_since(Instant::now()))
                    .is_ok()
                {
                    break;
                }
                panic!("watcher did not receive an event");
            }
        };
        let temp = dir.path().join("replacement.tmp");
        fs::write(&temp, "replacement").unwrap();
        fs::rename(temp, &path).unwrap();
        wait();
        assert_eq!(snapshot(&path).content.as_deref(), Some("replacement"));
        while rx.try_recv().is_ok() {}
        fs::remove_file(&path).unwrap();
        wait();
        assert_eq!(snapshot(&path).kind, "missing");
        while rx.try_recv().is_ok() {}
        fs::write(&path, "recreated").unwrap();
        wait();
        assert_eq!(snapshot(&path).content.as_deref(), Some("recreated"));
    }
}
