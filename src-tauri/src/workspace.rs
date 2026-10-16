use super::{read_document, DocumentFile, OpenedFiles};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct WorkspaceRoot(pub Mutex<Option<PathBuf>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    path: String,
    name: String,
    is_directory: bool,
    is_markdown: bool,
    is_file: bool,
    is_symlink: bool,
}

#[derive(Serialize)]
pub struct DirectoryRoot {
    path: String,
    name: String,
    entries: Vec<DirectoryEntry>,
}

fn markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| matches!(s.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown"))
        .unwrap_or(false)
}

// Resolve components and links before checking containment, not string prefixes.
fn contained(root: &Path, requested: &Path) -> Result<PathBuf, String> {
    let path = requested
        .canonicalize()
        .map_err(|e| format!("路径不可访问：{e}"))?;
    if !path.starts_with(root) {
        return Err("路径不在当前打开的目录中".into());
    }
    Ok(path)
}

fn list(root: &Path, requested: &Path) -> Result<Vec<DirectoryEntry>, String> {
    let path = contained(root, requested)?;
    let reader = fs::read_dir(path).map_err(|e| format!("无法读取目录：{e}"))?;
    let mut entries = Vec::new();
    for item in reader {
        let item = item.map_err(|e| format!("无法读取目录项：{e}"))?;
        if entries.len() >= 10_000 {
            return Err("当前目录超过 10000 项，请打开更小的子目录".into());
        }
        let kind = item
            .file_type()
            .map_err(|e| format!("无法读取文件类型：{e}"))?;
        entries.push(DirectoryEntry {
            path: item.path().to_string_lossy().into_owned(),
            name: item.file_name().to_string_lossy().into_owned(),
            is_directory: kind.is_dir(),
            is_file: kind.is_file(),
            is_symlink: kind.is_symlink(),
            is_markdown: kind.is_file() && markdown_file(&item.path()),
        });
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

fn current_root(root: &WorkspaceRoot, expected: &str) -> Result<PathBuf, String> {
    let current = root.0.lock().map_err(|e| e.to_string())?;
    match current.as_ref() {
        Some(path) if path == Path::new(expected) => Ok(path.clone()),
        _ => Err("工作目录已切换，请刷新文件树".into()),
    }
}

// Only callers that have validated an explicit user choice or a recorded recent root use this.
pub(crate) fn open_recorded_directory(
    app: &tauri::AppHandle,
    path: PathBuf,
) -> Result<DirectoryRoot, String> {
    let entries = list(&path, &path)?;
    *app.state::<WorkspaceRoot>()
        .0
        .lock()
        .map_err(|e| e.to_string())? = Some(path.clone());
    Ok(DirectoryRoot {
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        path: path.to_string_lossy().into_owned(),
        entries,
    })
}

#[tauri::command]
pub async fn open_directory(app: tauri::AppHandle) -> Result<Option<DirectoryRoot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let entries = list(&path, &path)?;
        *app.state::<WorkspaceRoot>()
            .0
            .lock()
            .map_err(|e| e.to_string())? = Some(path.clone());
        Ok(Some(DirectoryRoot {
            name: path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string()),
            path: path.to_string_lossy().into_owned(),
            entries,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_directory(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<Vec<DirectoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = current_root(&app.state::<WorkspaceRoot>(), &root)?;
        list(&root, Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_workspace_document(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<DocumentFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = current_root(&app.state::<WorkspaceRoot>(), &root)?;
        let path = contained(&root, Path::new(&path))?;
        let file = read_document(&path)?;
        app.state::<OpenedFiles>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path);
        Ok(file)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn close_directory(root: State<'_, WorkspaceRoot>) {
    if let Ok(mut current) = root.0.lock() {
        *current = None;
    }
}

// Mutation paths must name real entries beneath the selected root, without link components.
fn mutation_path(root: &Path, requested: &Path, allow_root: bool) -> Result<PathBuf, String> {
    let suffix = requested
        .strip_prefix(root)
        .map_err(|_| "路径不在当前打开的目录中")?;
    let mut path = root.to_path_buf();
    for component in suffix.components() {
        let std::path::Component::Normal(name) = component else {
            return Err("路径包含无效层级".into());
        };
        path.push(name);
        if fs::symlink_metadata(&path)
            .map_err(|e| format!("路径不可访问：{e}"))?
            .file_type()
            .is_symlink()
        {
            return Err("暂不操作符号链接及其子项".into());
        }
    }
    if path == root && !allow_root {
        return Err("不能重命名或删除工作目录本身".into());
    }
    contained(root, &path)
}
fn valid_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
    {
        return Err(
            "名称不能为空，不能含路径分隔符、控制字符或 \\ / : * ? \" < > |，也不能以空格或点结尾"
                .into(),
        );
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("该名称为系统保留名称，请换一个名称".into());
    }
    Ok(())
}
fn create_entry(
    root: &Path,
    parent: &Path,
    name: &str,
    directory: bool,
) -> Result<PathBuf, String> {
    valid_name(name)?;
    let parent = mutation_path(root, parent, true)?;
    if !parent.is_dir() {
        return Err("请选择父文件夹".into());
    }
    let path = parent.join(name);
    if directory {
        fs::create_dir(&path).map_err(|e| format!("无法新建文件夹（请检查重名或权限）：{e}"))?;
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("无法新建文件（请检查重名或权限）：{e}"))?
            .sync_all()
            .map_err(|e| e.to_string())?;
    }
    Ok(path)
}
#[derive(Deserialize)]
pub struct ExpectedFile {
    path: String,
    content: String,
}
fn check_expected(path: &Path, expected: &[ExpectedFile]) -> Result<(), String> {
    for file in expected {
        let item = Path::new(&file.path);
        if !item.starts_with(path) {
            return Err("文件快照不属于当前操作范围".into());
        }
        if read_document(item)?.content != file.content {
            return Err("已打开文件的磁盘内容已变化，请先处理外部修改再操作".into());
        }
    }
    Ok(())
}

// Use exclusive rename primitives so a concurrently created destination is never replaced.
fn rename_exclusive(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let source = CString::new(source.as_os_str().as_bytes())?;
        let target = CString::new(target.as_os_str().as_bytes())?;
        #[cfg(target_os = "macos")]
        let result =
            unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                target.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        fs::rename(source, target)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "该平台尚不支持安全重命名",
        ))
    }
}
fn rename_entry(
    root: &Path,
    path: &Path,
    name: &str,
    expected: &[ExpectedFile],
) -> Result<PathBuf, String> {
    valid_name(name)?;
    let source = mutation_path(root, path, false)?;
    let target = source.parent().ok_or("无效父目录")?.join(name);
    if target == source {
        return Ok(source);
    }
    if fs::symlink_metadata(&target).is_ok() {
        return Err("目标名称已存在，未覆盖；大小写改名请先使用一个临时名称".into());
    }
    check_expected(&source, expected)?;
    rename_exclusive(&source, &target).map_err(|e| format!("无法重命名：{e}"))?;
    Ok(target)
}
fn trash_entry(
    root: &Path,
    path: &Path,
    expected: &[ExpectedFile],
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let path = mutation_path(root, path, false)?;
    check_expected(&path, expected)?;
    recycle(&path)
}
#[tauri::command]
pub async fn create_workspace_entry(
    app: tauri::AppHandle,
    root: String,
    parent: String,
    name: String,
    directory: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceRoot>();
        let selected = state.0.lock().map_err(|e| e.to_string())?;
        let current = selected
            .as_ref()
            .filter(|p| **p == Path::new(&root))
            .ok_or("工作目录已切换")?;
        create_entry(current, Path::new(&parent), &name, directory)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rename_workspace_entry(
    app: tauri::AppHandle,
    root: String,
    path: String,
    name: String,
    expected: Vec<ExpectedFile>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceRoot>();
        let selected = state.0.lock().map_err(|e| e.to_string())?;
        let current = selected
            .as_ref()
            .filter(|p| **p == Path::new(&root))
            .ok_or("工作目录已切换")?;
        let files = app.state::<OpenedFiles>();
        let mut opened = files.0.lock().map_err(|e| e.to_string())?;
        let source = PathBuf::from(&path);
        let target = rename_entry(current, &source, &name, &expected)?;
        *opened = opened
            .iter()
            .map(|item| {
                item.strip_prefix(&source)
                    .map(|suffix| target.join(suffix))
                    .unwrap_or_else(|_| item.clone())
            })
            .collect();
        drop(opened);
        drop(selected);
        crate::recents::update_after_mutation(&app, &source, Some(&target));
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn trash_workspace_entry(
    app: tauri::AppHandle,
    root: String,
    path: String,
    expected: Vec<ExpectedFile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceRoot>();
        let selected = state.0.lock().map_err(|e| e.to_string())?;
        let current = selected
            .as_ref()
            .filter(|p| **p == Path::new(&root))
            .ok_or("工作目录已切换")?;
        let files = app.state::<OpenedFiles>();
        let mut opened = files.0.lock().map_err(|e| e.to_string())?;
        let source = PathBuf::from(&path);
        trash_entry(current, &source, &expected, |p| {
            trash::delete(p).map_err(|e| format!("移到系统回收站失败，未改为永久删除：{e}"))
        })?;
        opened.retain(|item| !item.starts_with(&source));
        drop(opened);
        drop(selected);
        crate::recents::update_after_mutation(&app, &source, None);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_unicode_entries_without_overwriting_and_rejects_invalid_names() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let folder = create_entry(&root, &root, "中文 空格", true).unwrap();
        let file = create_entry(&root, &folder, "笔记.md", false).unwrap();
        fs::write(&file, "keep").unwrap();
        assert!(create_entry(&root, &folder, "笔记.md", false).is_err());
        assert!(create_entry(&root, &root, "中文 空格", true).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "keep");
        for name in [
            "",
            " ",
            ".",
            "..",
            "../escape",
            "a/b",
            "a\\b",
            "a\0b",
            "CON.txt",
            "LPT1",
            "a.",
            "a ",
            "a:b",
        ] {
            assert!(valid_name(name).is_err(), "{name:?}");
        }
        assert!(valid_name(".gitignore").is_ok());
        assert!(create_entry(&root, &file, "bad", false).is_err());
    }
    #[test]
    fn renames_files_and_nonempty_folders_but_protects_existing_targets_and_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("docs")).unwrap();
        fs::write(root.join("docs/a.md"), "# keep").unwrap();
        fs::write(root.join("existing"), "untouched").unwrap();
        assert!(rename_entry(&root, &root.join("docs"), "existing", &[]).is_err());
        let stale = vec![ExpectedFile {
            path: root.join("docs/a.md").to_string_lossy().into_owned(),
            content: "old".into(),
        }];
        assert!(rename_entry(&root, &root.join("docs"), "new", &stale).is_err());
        assert!(root.join("docs/a.md").exists());
        let expected = vec![ExpectedFile {
            path: root.join("docs/a.md").to_string_lossy().into_owned(),
            content: "# keep".into(),
        }];
        let target = rename_entry(&root, &root.join("docs"), "新目录", &expected).unwrap();
        assert_eq!(fs::read_to_string(target.join("a.md")).unwrap(), "# keep");
        let file = rename_entry(&root, &target.join("a.md"), "renamed.txt", &[]).unwrap();
        assert!(file.exists());
        assert_eq!(
            fs::read_to_string(root.join("existing")).unwrap(),
            "untouched"
        );
        assert!(rename_entry(&root, &root, "oops", &[]).is_err());
        let collision = root.join("existing");
        assert!(rename_exclusive(&file, &collision).is_err());
        assert_eq!(fs::read_to_string(&collision).unwrap(), "untouched");
        assert!(file.exists());
    }
    #[test]
    fn trash_dispatch_preserves_files_on_failure_and_blocks_stale_or_outside_requests() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let file = root.join("a.txt");
        fs::write(&file, "original").unwrap();
        assert!(trash_entry(
            &root,
            &file,
            &[],
            |_| Err("system trash unavailable".into())
        )
        .is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "original");
        assert!(trash_entry(&root, &root, &[], |_| panic!("root cannot reach trash")).is_err());
        let outside = tempfile::tempdir().unwrap();
        assert!(trash_entry(&root, outside.path(), &[], |_| panic!(
            "outside cannot reach trash"
        ))
        .is_err());
        let stale = vec![ExpectedFile {
            path: file.to_string_lossy().into_owned(),
            content: "stale".into(),
        }];
        assert!(trash_entry(&root, &file, &stale, |_| panic!("stale cannot reach trash")).is_err());
        let recycle = root.join("test-recycle");
        fs::create_dir(&recycle).unwrap();
        trash_entry(&root, &file, &[], |p| {
            fs::rename(p, recycle.join("a.txt")).map_err(|e| e.to_string())
        })
        .unwrap();
        assert!(!file.exists());
        assert_eq!(
            fs::read_to_string(recycle.join("a.txt")).unwrap(),
            "original"
        );
    }
    #[cfg(unix)]
    #[test]
    fn mutations_reject_symlink_ancestors_even_when_they_point_inside_root() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("real")).unwrap();
        fs::write(root.join("real/a.md"), "keep").unwrap();
        symlink(root.join("real"), root.join("alias")).unwrap();
        assert!(create_entry(&root, &root.join("alias"), "x", false).is_err());
        assert!(rename_entry(&root, &root.join("alias/a.md"), "b.md", &[]).is_err());
        assert!(trash_entry(&root, &root.join("alias"), &[], |_| panic!(
            "link cannot reach trash"
        ))
        .is_err());
        assert!(mutation_path(&root, &root.join("real/../real/a.md"), false).is_err());
        assert_eq!(fs::read_to_string(root.join("real/a.md")).unwrap(), "keep");
    }
    #[test]
    fn lists_one_level_directories_first_with_markdown_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("docs")).unwrap();
        fs::write(root.join("docs/child.md"), "# child").unwrap();
        fs::write(root.join("Z.MD"), "# markdown").unwrap();
        fs::write(root.join("a.txt"), "text").unwrap();
        let entries = list(&root, &root).unwrap();
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            vec!["docs", "a.txt", "Z.MD"]
        );
        assert!(entries[0].is_directory);
        assert!(!entries[1].is_markdown);
        assert!(entries[1].is_file);
        assert!(entries[2].is_markdown);
        assert_eq!(list(&root, &root.join("docs")).unwrap()[0].name, "child.md");
    }
    #[test]
    fn rejects_traversal_prefix_siblings_and_old_roots() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let root = parent.join("notes");
        let other = parent.join("notes-other");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&other).unwrap();
        assert!(contained(&root, &root.join("../notes-other")).is_err());
        assert!(list(&root, &other).is_err());
        let state = WorkspaceRoot(Mutex::new(Some(other.clone())));
        assert!(current_root(&state, root.to_str().unwrap()).is_err());
        assert_eq!(
            current_root(&state, other.to_str().unwrap()).unwrap(),
            other
        );
    }
    #[cfg(unix)]
    #[test]
    fn links_do_not_escape_or_recursively_loop() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "outside").unwrap();
        symlink(outside.path(), root.join("outside")).unwrap();
        symlink(&root, root.join("loop")).unwrap();
        symlink(outside.path().join("secret.md"), root.join("link.md")).unwrap();
        let entries = list(&root, &root).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries
            .iter()
            .all(|e| e.is_symlink && !e.is_directory && !e.is_markdown));
        assert!(contained(&root, &root.join("link.md")).is_err());
    }
}
