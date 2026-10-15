mod menu;
mod workspace;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct OpenedFiles(Mutex<HashSet<PathBuf>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentFile {
    path: String,
    name: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    path: Option<String>,
    content: String,
    expected_content: Option<String>,
    save_as: bool,
    #[serde(default)]
    protected_paths: Vec<String>,
}

fn read_document(path: &Path) -> Result<DocumentFile, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法读取文件：{e}"))?;
    if !meta.is_file() {
        return Err("请选择 Markdown 文件".into());
    }
    if meta.len() > 16 * 1024 * 1024 {
        return Err("当前版本支持 16 MB 以内的 Markdown 文件".into());
    }
    let content = fs::read_to_string(path)
        .map_err(|e| format!("无法按 UTF-8 读取文件，请先转换编码：{e}"))?;
    Ok(DocumentFile {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        content,
    })
}

// Compare with the opened snapshot before replacing the file. Failed writes leave the original intact.
fn write_document(path: &Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    if let Some(expected) = expected {
        let current =
            fs::read_to_string(path).map_err(|e| format!("原文件无法读取，未保存：{e}"))?;
        if current != expected {
            return Err("文件已被其他程序修改，未覆盖。请另存为，或重新打开后再编辑。".into());
        }
    } else if path.exists() {
        return Err("目标文件已存在，请重新选择保存位置".into());
    }
    let parent = path.parent().ok_or("无效的保存路径")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法创建临时文件：{e}"))?;
    if let Ok(metadata) = fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| format!("无法保留文件权限：{e}"))?;
    }
    temporary
        .write_all(content.as_bytes())
        .map_err(|e| format!("写入失败：{e}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|e| format!("同步文件失败：{e}"))?;
    temporary
        .persist(path)
        .map_err(|e| format!("保存失败，原文件未替换：{e}"))?;
    Ok(())
}

#[tauri::command]
async fn open_document(app: tauri::AppHandle) -> Result<Option<DocumentFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown", "mdown"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let document = read_document(&path)?;
        app.state::<OpenedFiles>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path);
        Ok(Some(document))
    })
    .await
    .map_err(|e| e.to_string())?
}

// Do not overwrite a second tab, including one with unsaved in-memory changes.
fn reject_open_target(path: &Path, protected: &[String]) -> Result<(), String> {
    if protected.iter().any(|other| Path::new(other) == path) {
        return Err("目标文件已在其他标签中打开，请切换到该标签或选择其他保存位置".into());
    }
    Ok(())
}

#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    request: SaveRequest,
) -> Result<Option<DocumentFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let choose = request.save_as || request.path.is_none();
        let path = if choose {
            let suggested = request
                .path
                .as_deref()
                .and_then(|p| Path::new(p).file_name())
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or("未命名.md".into());
            let Some(file) = app
                .dialog()
                .file()
                .add_filter("Markdown", &["md", "markdown"])
                .set_file_name(suggested)
                .blocking_save_file()
            else {
                return Ok(None);
            };
            let picked = file.into_path().map_err(|e| e.to_string())?;
            if picked.exists() {
                picked.canonicalize().map_err(|e| e.to_string())?
            } else {
                picked
            }
        } else {
            let path = PathBuf::from(request.path.as_ref().ok_or("缺少文件路径")?);
            if !app
                .state::<OpenedFiles>()
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .contains(&path)
            {
                return Err("请通过打开文件对话框选择文件".into());
            }
            path
        };
        reject_open_target(&path, &request.protected_paths)?;
        let same_file = request.path.as_deref() == Some(path.to_string_lossy().as_ref());
        let expected = if same_file {
            request.expected_content.clone()
        } else if choose && path.exists() {
            Some(fs::read_to_string(&path).map_err(|e| format!("无法读取目标文件：{e}"))?)
        } else {
            None
        };
        write_document(&path, &request.content, expected.as_deref())?;
        app.state::<OpenedFiles>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(path.clone());
        // Return the saved snapshot, not a second disk read that could race an external writer.
        Ok(Some(DocumentFile {
            path: path.to_string_lossy().into_owned(),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            content: request.content,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn release_document(path: String, files: State<'_, OpenedFiles>) {
    if let Ok(mut paths) = files.0.lock() {
        paths.remove(&PathBuf::from(path));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedFiles::default())
        .manage(workspace::WorkspaceRoot::default())
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(menu::dispatch)
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            release_document,
            workspace::open_directory,
            workspace::list_directory,
            workspace::read_workspace_document,
            workspace::close_directory
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 MinMD");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn open_edit_save_and_reopen_chinese_markdown() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文 文档.md");
        let original = "\u{feff}# 标题\r\n\r\n原始内容\r\n";
        fs::write(&path, original).unwrap();
        let opened = read_document(&path).unwrap();
        assert_eq!(opened.content, original);
        let edited = "\u{feff}# 标题\r\n\r\n**编辑完成**\r\n";
        write_document(&path, edited, Some(&opened.content)).unwrap();
        assert_eq!(read_document(&path).unwrap().content, edited);
    }
    #[test]
    fn conflicting_or_deleted_file_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.md");
        fs::write(&path, "external change").unwrap();
        assert!(write_document(&path, "mine", Some("original")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external change");
        fs::remove_file(&path).unwrap();
        assert!(write_document(&path, "mine", Some("original")).is_err());
        assert!(!path.exists());
    }
    #[test]
    fn refuses_save_as_to_another_open_tab() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("other.md");
        fs::write(&target, "original").unwrap();
        assert!(reject_open_target(&target, &[target.to_string_lossy().into_owned()]).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert!(reject_open_target(&target, &[]).is_ok());
    }
    #[test]
    fn new_file_and_utf8_validation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.md");
        write_document(&path, "# 新文档", None).unwrap();
        assert_eq!(read_document(&path).unwrap().content, "# 新文档");
        assert!(write_document(&path, "overwrite", None).is_err());
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(read_document(&path).unwrap_err().contains("UTF-8"));
    }
}
