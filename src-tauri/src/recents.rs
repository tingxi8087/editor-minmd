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
pub struct RecentIo(Mutex<Option<String>>);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecentEntry {
    path: String,
    name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecentEntries {
    files: Vec<RecentEntry>,
    directories: Vec<RecentEntry>,
}

fn storage(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recents.json"))
}

fn load(path: &Path) -> Result<RecentEntries, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RecentEntries::default())
        }
        Err(error) => return Err(format!("无法读取最近记录：{error}")),
    };
    let mut bytes = Vec::new();
    file.take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取最近记录：{e}"))?;
    if bytes.len() > 256 * 1024 {
        return Err("最近记录文件过大，未覆盖。可清空最近记录后重新使用。".into());
    }
    let mut entries: RecentEntries = serde_json::from_slice(&bytes)
        .map_err(|_| "最近记录文件损坏，未覆盖。可清空最近记录后重新使用。")?;
    // Stored paths may be missing. Keep them visible so the user can remove them explicitly.
    normalize(&mut entries.files, 20);
    normalize(&mut entries.directories, 10);
    Ok(entries)
}

fn normalize(entries: &mut Vec<RecentEntry>, limit: usize) {
    let mut seen = HashSet::new();
    entries.retain(|entry| Path::new(&entry.path).is_absolute() && seen.insert(entry.path.clone()));
    entries.truncate(limit);
}

fn write(path: &Path, entries: &RecentEntries) -> Result<(), String> {
    let parent = path.parent().ok_or("最近记录存储路径无效")?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建最近记录目录：{e}"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("无法创建最近记录临时文件：{e}"))?;
    serde_json::to_writer(&mut temporary, entries).map_err(|e| format!("无法写入最近记录：{e}"))?;
    temporary
        .flush()
        .map_err(|e| format!("无法写入最近记录：{e}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("无法同步最近记录：{e}"))?;
    temporary
        .persist(path)
        .map_err(|e| format!("无法保存最近记录，原记录未替换：{e}"))?;
    Ok(())
}

fn checked_path(path: &str, directory: bool) -> Result<PathBuf, String> {
    let path = Path::new(path).canonicalize().map_err(|e| {
        format!(
            "{}已移动、删除或不可访问：{e}",
            if directory {
                "最近目录"
            } else {
                "最近文件"
            }
        )
    })?;
    if directory {
        if !path.is_dir() {
            return Err("最近目录已不是文件夹，请移除此记录".into());
        }
    } else {
        read_document(&path)?;
    }
    Ok(path)
}

fn record(path: &Path, requested: &str, directory: bool) -> Result<RecentEntries, String> {
    let resolved = checked_path(requested, directory)?;
    let entry = RecentEntry {
        name: resolved
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| resolved.display().to_string()),
        path: resolved.to_string_lossy().into_owned(),
    };
    let mut entries = load(path)?;
    let list = if directory {
        &mut entries.directories
    } else {
        &mut entries.files
    };
    list.retain(|other| other.path != entry.path);
    list.insert(0, entry);
    list.truncate(if directory { 10 } else { 20 });
    write(path, &entries)?;
    Ok(entries)
}

fn require_recorded(
    entries: &RecentEntries,
    requested: &str,
    directory: bool,
) -> Result<PathBuf, String> {
    let list = if directory {
        &entries.directories
    } else {
        &entries.files
    };
    if !list.iter().any(|entry| entry.path == requested) {
        return Err("该路径不在最近记录中，请通过打开对话框选择".into());
    }
    let resolved = checked_path(requested, directory)?;
    // A path that has become a symlink must not silently grant access to another target.
    if resolved != Path::new(requested) {
        return Err("最近路径的实际位置已变化，请通过打开对话框重新选择".into());
    }
    Ok(resolved)
}

fn update_paths(storage: &Path, source: &Path, target: Option<&Path>) -> Result<(), String> {
    let mut entries = load(storage)?;
    for (list, limit) in [(&mut entries.files, 20), (&mut entries.directories, 10)] {
        list.retain_mut(|entry| {
            let Ok(suffix) = Path::new(&entry.path).strip_prefix(source) else {
                return true;
            };
            let Some(target) = target else {
                return false;
            };
            let replacement = if suffix.as_os_str().is_empty() {
                target.to_path_buf()
            } else {
                target.join(suffix)
            };
            entry.name = replacement
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| replacement.display().to_string());
            entry.path = replacement.to_string_lossy().into_owned();
            true
        });
        normalize(list, limit);
    }
    write(storage, &entries)
}

// A successful filesystem operation remains successful even if its optional history update fails.
// The next history refresh reports this warning, and a subsequent refresh can show the preserved file.
pub(crate) fn update_after_mutation(app: &tauri::AppHandle, source: &Path, target: Option<&Path>) {
    let io = app.state::<RecentIo>();
    if let Ok(mut guard) = io.0.lock() {
        if let Err(error) = storage(app).and_then(|path| update_paths(&path, source, target)) {
            *guard = Some(format!("文件操作已完成，但最近记录未能同步：{error}"));
        }
    };
}

#[tauri::command]
pub async fn load_recent_entries(app: tauri::AppHandle) -> Result<RecentEntries, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<RecentIo>();
        let mut guard = io.0.lock().map_err(|e| e.to_string())?;
        if let Some(error) = guard.take() {
            return Err(error);
        }
        load(&storage(&app)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn record_recent_entry(
    app: tauri::AppHandle,
    path: String,
    directory: bool,
) -> Result<RecentEntries, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<RecentIo>();
        let _guard = io.0.lock().map_err(|e| e.to_string())?;
        let resolved = checked_path(&path, directory)?;
        let authorized = if directory {
            app.state::<workspace::WorkspaceRoot>()
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .as_ref()
                == Some(&resolved)
        } else {
            app.state::<OpenedFiles>()
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .contains(&resolved)
        };
        if !authorized {
            return Err("请先通过打开或保存操作选择此路径，再加入最近记录".into());
        }
        record(&storage(&app)?, &path, directory)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_recent_entry(
    app: tauri::AppHandle,
    path: String,
    directory: bool,
) -> Result<RecentEntries, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<RecentIo>();
        let _guard = io.0.lock().map_err(|e| e.to_string())?;
        let storage = storage(&app)?;
        let mut entries = load(&storage)?;
        let list = if directory {
            &mut entries.directories
        } else {
            &mut entries.files
        };
        list.retain(|entry| entry.path != path);
        write(&storage, &entries)?;
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_recent_entries(
    app: tauri::AppHandle,
    directory: Option<bool>,
) -> Result<RecentEntries, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<RecentIo>();
        let mut guard = io.0.lock().map_err(|e| e.to_string())?;
        let storage = storage(&app)?;
        // An explicit full clear also recovers a corrupt library; ordinary writes never overwrite it.
        let mut entries = if directory.is_none() {
            RecentEntries::default()
        } else {
            load(&storage)?
        };
        match directory {
            Some(true) => entries.directories.clear(),
            Some(false) => entries.files.clear(),
            None => {}
        }
        write(&storage, &entries)?;
        *guard = None;
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_recent_document(
    app: tauri::AppHandle,
    path: String,
) -> Result<DocumentFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<RecentIo>();
        let _guard = io.0.lock().map_err(|e| e.to_string())?;
        let resolved = require_recorded(&load(&storage(&app)?)?, &path, false)?;
        let document = read_document(&resolved)?;
        app.state::<OpenedFiles>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(resolved);
        Ok(document)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_recent_directory(
    app: tauri::AppHandle,
    path: String,
) -> Result<workspace::DirectoryRoot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<RecentIo>();
        let _guard = io.0.lock().map_err(|e| e.to_string())?;
        let resolved = require_recorded(&load(&storage(&app)?)?, &path, true)?;
        workspace::open_recorded_directory(&app, resolved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_library_is_empty_and_records_unicode_paths_atomically() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("app/recents.json");
        assert_eq!(load(&library).unwrap(), RecentEntries::default());
        let file = root.path().join("中文 空格 # (1).md");
        fs::write(&file, "正文").unwrap();
        let entries = record(&library, file.to_str().unwrap(), false).unwrap();
        assert_eq!(entries.files[0].name, "中文 空格 # (1).md");
        assert_eq!(entries, load(&library).unwrap());
        assert_eq!(fs::read_dir(library.parent().unwrap()).unwrap().count(), 1);
    }

    #[test]
    fn mru_deduplicates_canonical_paths_and_caps_each_kind() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        let mut files = Vec::new();
        for index in 0..23 {
            let path = root.path().join(format!("file-{index}.md"));
            fs::write(&path, "a").unwrap();
            record(&library, path.to_str().unwrap(), false).unwrap();
            files.push(path);
        }
        let entries = record(&library, files[5].to_str().unwrap(), false).unwrap();
        assert_eq!(entries.files.len(), 20);
        assert_eq!(entries.files[0].path, files[5].to_string_lossy());
        assert_eq!(
            entries
                .files
                .iter()
                .filter(|e| e.path == files[5].to_string_lossy())
                .count(),
            1
        );
        for index in 0..12 {
            let path = root.path().join(format!("dir-{index}"));
            fs::create_dir(&path).unwrap();
            record(&library, path.to_str().unwrap(), true).unwrap();
        }
        let entries = load(&library).unwrap();
        assert_eq!(entries.directories.len(), 10);
        assert_eq!(entries.files.len(), 20);
        let nested = root.path().join("file-5.md");
        let alias = root.path().join("./file-5.md");
        assert_eq!(
            record(&library, alias.to_str().unwrap(), false)
                .unwrap()
                .files[0]
                .path,
            nested.to_string_lossy()
        );
    }

    #[test]
    fn invalid_or_missing_targets_never_change_records() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        let good = root.path().join("good.md");
        fs::write(&good, "good").unwrap();
        record(&library, good.to_str().unwrap(), false).unwrap();
        let before = fs::read(&library).unwrap();
        let binary = root.path().join("binary");
        fs::write(&binary, [0, 1, 2]).unwrap();
        for (path, directory) in [
            (&binary, false),
            (&good, true),
            (&root.path().join("missing"), false),
            (&root.path().to_path_buf(), false),
        ] {
            assert!(record(&library, path.to_str().unwrap(), directory).is_err());
            assert_eq!(fs::read(&library).unwrap(), before);
        }
        fs::remove_file(&good).unwrap();
        let entries = load(&library).unwrap();
        assert_eq!(entries.files.len(), 1);
        assert!(require_recorded(&entries, good.to_str().unwrap(), false)
            .unwrap_err()
            .contains("已移动"));
        assert_eq!(fs::read(&library).unwrap(), before);
    }

    #[test]
    fn corrupt_library_is_preserved_until_explicit_clear() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        fs::write(&library, "{broken").unwrap();
        let good = root.path().join("good.md");
        fs::write(&good, "a").unwrap();
        assert!(load(&library).unwrap_err().contains("损坏"));
        assert!(record(&library, good.to_str().unwrap(), false).is_err());
        assert_eq!(fs::read_to_string(&library).unwrap(), "{broken");
        write(&library, &RecentEntries::default()).unwrap();
        assert_eq!(load(&library).unwrap(), RecentEntries::default());
    }

    #[test]
    fn unrecorded_and_wrong_kind_paths_cannot_grant_access() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        let file = root.path().join("a.md");
        fs::write(&file, "a").unwrap();
        let entries = record(&library, file.to_str().unwrap(), false).unwrap();
        assert_eq!(
            require_recorded(&entries, file.to_str().unwrap(), false).unwrap(),
            file.canonicalize().unwrap()
        );
        assert!(require_recorded(&entries, root.path().to_str().unwrap(), true).is_err());
        assert!(require_recorded(&entries, file.to_str().unwrap(), true).is_err());
        assert!(
            require_recorded(&RecentEntries::default(), file.to_str().unwrap(), false).is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn changed_symlink_target_requires_new_explicit_open() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        let file = root.path().join("a.md");
        let target = root.path().join("private.md");
        fs::write(&file, "a").unwrap();
        fs::write(&target, "private").unwrap();
        let entries = record(&library, file.to_str().unwrap(), false).unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&target, &file).unwrap();
        assert!(require_recorded(&entries, file.to_str().unwrap(), false)
            .unwrap_err()
            .contains("实际位置已变化"));
    }

    #[test]
    fn failed_atomic_replace_preserves_destination() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        fs::create_dir(&library).unwrap();
        fs::write(library.join("keep"), "untouched").unwrap();
        assert!(write(&library, &RecentEntries::default()).is_err());
        assert_eq!(
            fs::read_to_string(library.join("keep")).unwrap(),
            "untouched"
        );
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn rename_and_trash_remap_only_whole_path_components() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let library = root.path().join("recents.json");
        let source = root.path().join("docs");
        let sibling = root.path().join("docs-other");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&sibling).unwrap();
        let child = source.join("中文.md");
        let sibling_child = sibling.join("keep.md");
        fs::write(&child, "a").unwrap();
        fs::write(&sibling_child, "b").unwrap();
        record(&library, source.to_str().unwrap(), true).unwrap();
        record(&library, child.to_str().unwrap(), false).unwrap();
        record(&library, sibling_child.to_str().unwrap(), false).unwrap();
        let target = root.path().join("new docs");
        fs::rename(&source, &target).unwrap();
        update_paths(&library, &source, Some(&target)).unwrap();
        let entries = load(&library).unwrap();
        assert_eq!(entries.directories[0].path, target.to_string_lossy());
        assert_eq!(entries.directories[0].name, "new docs");
        assert_eq!(
            entries.files[1].path,
            target.join("中文.md").to_string_lossy()
        );
        assert_eq!(entries.files[0].path, sibling_child.to_string_lossy());
        update_paths(&library, &target, None).unwrap();
        let entries = load(&library).unwrap();
        assert!(entries.directories.is_empty());
        assert_eq!(entries.files.len(), 1);
        assert_eq!(entries.files[0].path, sibling_child.to_string_lossy());
    }
}
