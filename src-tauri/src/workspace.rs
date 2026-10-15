use super::{read_document, DocumentFile, OpenedFiles};
use serde::Serialize;
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
        if !markdown_file(&path) {
            return Err("当前文件树仅支持打开 Markdown 文件".into());
        }
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

#[cfg(test)]
mod tests {
    use super::*;
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
