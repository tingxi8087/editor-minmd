mod associations;
mod background;
mod menu;
mod recents;
mod reliability;
mod resources;
mod session;
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
    #[serde(default)]
    resources: Option<resources::ResourceContext>,
    #[serde(default)]
    suggested_name: Option<String>,
}

fn read_document(path: &Path) -> Result<DocumentFile, String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|e| format!("无法读取文件：{e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("请选择普通文本文件".into());
    }
    let mut bytes = Vec::new();
    file.take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取文件：{e}"))?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("当前版本支持 16 MB 以内的 UTF-8 文本文件".into());
    }
    let content = String::from_utf8(bytes)
        .map_err(|e| format!("无法按 UTF-8 读取文件，请先转换编码：{e}"))?;
    if content.contains('\0') {
        return Err("文件包含 NUL 字节，可能是二进制文件，未作为文本打开".into());
    }
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
    if content.contains('\0') {
        return Err("正文包含 NUL 字节，未写入文本文件".into());
    }
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
        let Some(file) = app.dialog().file().blocking_pick_file() else {
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
                .unwrap_or_else(|| request.suggested_name.clone().unwrap_or("未命名.md".into()));
            let Some(file) = app
                .dialog()
                .file()
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
        let content =
            resources::rebase_content(&request.content, request.resources.as_ref(), &path)?;
        write_document(&path, &content, expected.as_deref())?;
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
            content,
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
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .manage(OpenedFiles::default())
        .manage(associations::PendingFiles::default())
        .manage(reliability::RecoveryLock::default())
        .manage(reliability::DocumentWatcher::default())
        .manage(workspace::WorkspaceRoot::default())
        .manage(recents::RecentIo::default())
        .manage(session::SessionIo::default())
        .plugin(tauri_plugin_dialog::init())
        .menu(menu::build)
        .on_menu_event(menu::dispatch)
        .manage(background::BackgroundIo::default())
        .invoke_handler(tauri::generate_handler![
            session::restore_workspace_session,
            session::write_workspace_session,
            recents::load_recent_entries,
            recents::record_recent_entry,
            recents::remove_recent_entry,
            recents::clear_recent_entries,
            recents::open_recent_document,
            recents::open_recent_directory,
            associations::association_platform,
            associations::set_default_associations,
            associations::take_external_files,
            background::load_background,
            background::choose_background,
            background::set_background_options,
            background::reset_background,
            resources::choose_markdown_reference,
            resources::load_document_image,
            resources::read_embedded_document,
            resources::import_document_image,
            resources::open_document_link,
            reliability::load_drafts,
            reliability::write_drafts,
            reliability::authorize_draft,
            reliability::check_documents,
            reliability::watch_documents,
            open_document,
            save_document,
            release_document,
            workspace::open_directory,
            workspace::list_directory,
            workspace::read_workspace_document,
            workspace::close_directory,
            workspace::create_workspace_entry,
            workspace::rename_workspace_entry,
            workspace::trash_workspace_entry
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 editor-minmd")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                associations::enqueue(
                    app,
                    urls.into_iter().filter_map(|url| url.to_file_path().ok()),
                );
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
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
    fn plain_code_files_preserve_literal_utf8_bom_crlf_and_trailing_lines() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["中文.ts", "config.json", "notes.txt", "Dockerfile"] {
            let path = dir.path().join(name);
            let source =
                "\u{feff}// # literal Markdown\r\nconst html = \"<div>**原样**</div>\";\r\n\r\n";
            fs::write(&path, source).unwrap();
            let file = read_document(&path).unwrap();
            assert_eq!(file.content, source);
            let content = format!("{source}// edit\r\n");
            write_document(&path, &content, Some(source)).unwrap();
            assert_eq!(read_document(&path).unwrap().content, content);
        }
    }
    #[test]
    fn rejects_binary_nul_and_oversized_reads_without_replacing_existing_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("binary.bin");
        fs::write(&path, b"abc\0def").unwrap();
        assert!(read_document(&path).unwrap_err().contains("NUL"));
        fs::write(&path, "original").unwrap();
        assert!(write_document(&path, "new\0text", Some("original")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        let file = fs::File::create(&path).unwrap();
        file.set_len(16 * 1024 * 1024 + 1).unwrap();
        assert!(read_document(&path).unwrap_err().contains("16 MB"));
        assert!(read_document(dir.path()).is_err());
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
