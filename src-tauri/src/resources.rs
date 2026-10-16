use super::{read_document, DocumentFile, OpenedFiles};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{Manager, State, Url};
use tauri_plugin_dialog::DialogExt;

const LIMIT: usize = 20 * 1024 * 1024;
fn authorized(files: &OpenedFiles, document: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(document);
    if !files.0.lock().map_err(|e| e.to_string())?.contains(&path) {
        return Err("请先打开或保存文档".into());
    }
    Ok(path)
}
fn resolve(document: &Path, reference: &str) -> Result<Url, String> {
    let base = Url::from_file_path(document).map_err(|_| "无效的文档路径")?;
    base.join(reference)
        .map_err(|e| format!("无效的资源地址：{e}"))
}
fn image_kind(data: &[u8]) -> Result<(&'static str, &'static str), String> {
    if data.len() > LIMIT {
        return Err("图片不能超过 20 MB".into());
    }
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok(("png", "image/png"))
    } else if data.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok(("jpg", "image/jpeg"))
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Ok(("gif", "image/gif"))
    } else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") {
        Ok(("webp", "image/webp"))
    } else {
        Err("仅支持 PNG、JPEG、GIF、WebP 图片".into())
    }
}
fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("图片无法读取：{e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("图片路径不是文件".into());
    }
    use std::io::Read;
    let mut data = Vec::new();
    file.take((LIMIT + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    image_kind(&data)?;
    Ok(data)
}
fn markdown_reference(document: &Path, target: &Path) -> Result<ImportedImage, String> {
    let target = target
        .canonicalize()
        .map_err(|e| format!("文件不存在或不可访问：{e}"))?;
    if !matches!(
        target
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "md" | "markdown" | "mdown"
    ) {
        return Err("请选择 Markdown 文件".into());
    }
    // A reference must also be openable by this editor; reject binary/invalid UTF-8.
    let selected = read_document(&target)?;
    let base = Url::from_directory_path(document.parent().ok_or("无效的文档位置")?)
        .map_err(|_| "无效的文档路径")?;
    let url = Url::from_file_path(&target).map_err(|_| "无效的目标路径")?;
    let reference = base
        .make_relative(&url)
        .unwrap_or_else(|| url.to_string())
        .replace('(', "%28")
        .replace(')', "%29");
    Ok(ImportedImage {
        reference,
        name: selected.name,
    })
}
#[tauri::command]
pub async fn choose_markdown_reference(
    app: tauri::AppHandle,
    document: String,
) -> Result<Option<ImportedImage>, String> {
    let base = authorized(&app.state::<OpenedFiles>(), &document)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("Markdown", &["md", "markdown", "mdown"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let target = file.into_path().map_err(|e| e.to_string())?;
        markdown_reference(&base, &target).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn load_document_image(
    document: String,
    reference: String,
    files: State<'_, OpenedFiles>,
) -> Result<String, String> {
    let path = authorized(&files, &document)?;
    tauri::async_runtime::spawn_blocking(move || {
        let url = resolve(&path, &reference)?;
        if url.scheme() != "file" {
            return Err("仅支持本地图片".into());
        }
        let data = read_image(&url.to_file_path().map_err(|_| "无效的图片路径")?)?;
        Ok(format!(
            "data:{};base64,{}",
            image_kind(&data)?.1,
            STANDARD.encode(&data)
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
pub struct ImportedImage {
    reference: String,
    name: String,
}
fn store_image(document: &Path, data: &[u8], name: &str) -> Result<ImportedImage, String> {
    let extension = image_kind(data)?.0;
    let parent = document.parent().ok_or("无效的文档目录")?;
    let assets = parent.join("assets");
    // Do not follow a pre-existing assets symlink when writing imported files.
    if fs::symlink_metadata(&assets)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("assets 是符号链接，请改为普通目录后再插入图片".into());
    }
    fs::create_dir_all(&assets).map_err(|e| format!("无法创建 assets 目录：{e}"))?;
    let mut output = tempfile::Builder::new()
        .prefix("image-")
        .suffix(&format!(".{extension}"))
        .tempfile_in(&assets)
        .map_err(|e| e.to_string())?;
    output.write_all(data).map_err(|e| e.to_string())?;
    output.as_file().sync_all().map_err(|e| e.to_string())?;
    let (_, path) = output.keep().map_err(|e| e.to_string())?;
    Ok(ImportedImage {
        reference: format!("assets/{}", path.file_name().unwrap().to_string_lossy()),
        name: name.into(),
    })
}
#[tauri::command]
pub async fn import_document_image(
    app: tauri::AppHandle,
    document: String,
    source: Option<String>,
    data: Option<Vec<u8>>,
    name: Option<String>,
) -> Result<Option<ImportedImage>, String> {
    let path = authorized(&app.state::<OpenedFiles>(), &document)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(data) = data {
            return store_image(&path, &data, &name.unwrap_or_else(|| "粘贴图片".into())).map(Some);
        }
        let source = if let Some(source) = source {
            PathBuf::from(source)
        } else {
            let Some(file) = app
                .dialog()
                .file()
                .add_filter("图片", &["png", "jpg", "jpeg", "gif", "webp"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            file.into_path().map_err(|e| e.to_string())?
        };
        let data = read_image(&source)?;
        store_image(
            &path,
            &data,
            &source.file_stem().unwrap_or_default().to_string_lossy(),
        )
        .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceContext {
    pub base_path: String,
    pub references: Vec<ResourceReference>,
}
#[derive(Deserialize)]
pub struct ResourceReference {
    pub token: String,
    pub value: String,
}
pub fn rebase_content(
    content: &str,
    context: Option<&ResourceContext>,
    destination: &Path,
) -> Result<String, String> {
    let Some(context) = context else {
        return Ok(content.into());
    };
    let base = Url::from_directory_path(destination.parent().ok_or("无效的保存路径")?)
        .map_err(|_| "无效的保存路径")?;
    let mut result = content.to_string();
    for reference in &context.references {
        let url = resolve(Path::new(&context.base_path), &reference.value)?;
        let drive = |url: &Url| {
            url.path()
                .split('/')
                .nth(1)
                .filter(|s| s.ends_with(':'))
                .map(str::to_ascii_lowercase)
        };
        let relative = if drive(&base) != drive(&url) {
            url.to_string()
        } else {
            base.make_relative(&url).unwrap_or_else(|| url.to_string())
        };
        // Parentheses delimit Markdown destinations; URL normalisation alone does not encode them.
        let relative = relative.replace('(', "%28").replace(')', "%29");
        result = result.replace(&reference.token, &relative);
    }
    Ok(result)
}
fn launch_web(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "无效的网址")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("仅支持 http 和 https 网页链接".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    command
        .arg(url.as_str())
        .spawn()
        .map_err(|e| format!("无法打开浏览器：{e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn open_document_link(
    document: String,
    reference: String,
    files: State<'_, OpenedFiles>,
) -> Result<Option<DocumentFile>, String> {
    if reference.to_ascii_lowercase().starts_with("https://")
        || reference.to_ascii_lowercase().starts_with("http://")
    {
        launch_web(&reference)?;
        return Ok(None);
    }
    let base = authorized(&files, &document)?;
    let url = resolve(&base, &reference)?;
    if url.scheme() != "file" {
        return Err("仅支持网页和本地 Markdown 链接".into());
    }
    let path = url
        .to_file_path()
        .map_err(|_| "无效的文件链接")?
        .canonicalize()
        .map_err(|e| format!("链接文件不存在或不可访问：{e}"))?;
    if !matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "md" | "markdown" | "mdown"
    ) {
        return Err("本地链接目前仅支持 Markdown 文件".into());
    }
    let document = read_document(&path)?;
    files.0.lock().map_err(|e| e.to_string())?.insert(path);
    Ok(Some(document))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn markdown_reference_uses_portable_encoded_paths_and_validates_content() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("子目录");
        fs::create_dir(&nested).unwrap();
        let target = nested.join("中文 # (1).md");
        fs::write(&target, "# 文档").unwrap();
        let document = dir.path().join("来源.md");
        let selected = markdown_reference(&document, &target).unwrap();
        assert_eq!(selected.name, "中文 # (1).md");
        assert!(!selected.reference.starts_with("file:"));
        assert!(selected.reference.contains("%23"));
        assert!(selected.reference.contains("%28"));
        assert_eq!(
            resolve(&document, &selected.reference)
                .unwrap()
                .to_file_path()
                .unwrap(),
            target.canonicalize().unwrap()
        );
        let binary = nested.join("bad.md");
        fs::write(&binary, [0, 1, 0]).unwrap();
        assert!(markdown_reference(&document, &binary).is_err());
        let other = nested.join("other.txt");
        fs::write(&other, "text").unwrap();
        assert!(markdown_reference(&document, &other).is_err());
        assert!(markdown_reference(&document, &nested.join("missing.md")).is_err());
    }
    #[test]
    fn imports_unique_raster_images_and_preserves_original() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("中文 文档.md");
        let data = b"\x89PNG\r\n\x1a\npayload";
        let a = store_image(&doc, data, "中文").unwrap();
        let b = store_image(&doc, data, "中文").unwrap();
        assert_ne!(a.reference, b.reference);
        assert_eq!(fs::read(dir.path().join(&a.reference)).unwrap(), data);
        assert!(store_image(&doc, b"<svg/>", "svg").is_err());
        assert!(image_kind(&vec![0; LIMIT + 1]).is_err());
    }
    #[test]
    fn rebases_images_links_and_missing_files_without_touching_text() {
        let ctx = ResourceContext {
            base_path: "/笔记/原目录/文档.md".into(),
            references: vec![
                ResourceReference {
                    token: "TOKEN1".into(),
                    value: "assets/中文%20图%281%29.png".into(),
                },
                ResourceReference {
                    token: "TOKEN2".into(),
                    value: "../链接.md#段落".into(),
                },
            ],
        };
        let result = rebase_content(
            "![图](TOKEN1) [链接](TOKEN2) assets/example.png",
            Some(&ctx),
            Path::new("/笔记/新目录/新.md"),
        )
        .unwrap();
        assert!(result.contains("../%E5%8E%9F%E7%9B%AE%E5%BD%95/assets/"));
        assert!(result.contains("%281%29.png"));
        assert!(result.ends_with("assets/example.png"));
        assert!(result.contains("#%E6%AE%B5%E8%90%BD"));
    }
    #[test]
    fn resolves_encoded_names_and_parent_paths() {
        let url = resolve(Path::new("/notes/中文.md"), "../images/a%20b%23c.png").unwrap();
        assert_eq!(
            url.to_file_path().unwrap(),
            PathBuf::from("/images/a b#c.png")
        );
        assert!(launch_web("javascript:alert(1)").is_err());
        assert!(authorized(&OpenedFiles::default(), "/not-open.md").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_assets_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("assets")).unwrap();
        assert!(store_image(&dir.path().join("test.md"), b"\x89PNG\r\n\x1a\n", "image").is_err());
    }
}
