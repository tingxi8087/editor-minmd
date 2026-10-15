use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const IMAGE_LIMIT: usize = 16 * 1024 * 1024;
const CONFIG: &str = "background-v1.json";
#[derive(Default)]
pub struct BackgroundIo(pub Mutex<()>);
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Config {
    version: u8,
    asset: Option<String>,
    name: Option<String>,
    blur: u8,
    mask: u8,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            asset: None,
            name: None,
            blur: 6,
            mask: 30,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundView {
    blur: u8,
    mask: u8,
    image: Option<BackgroundImage>,
    cleanup_warning: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundImage {
    name: String,
    data_url: String,
}
fn options(blur: u8, mask: u8) -> Result<(), String> {
    if blur > 24 || mask > 90 {
        return Err("模糊须在 0—24 px，遮罩须在 0—90%".into());
    }
    Ok(())
}
fn asset_name(name: &str) -> bool {
    name.strip_prefix("image-").is_some_and(|s| {
        (6..=32).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric())
    })
}
fn directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("无法创建背景目录：{e}"))?;
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("背景目录不能是符号链接".into());
    }
    Ok(())
}
fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "背景文件已丢失，请重新选择或恢复默认".into(),
        std::io::ErrorKind::PermissionDenied => "没有权限读取背景文件，请重新选择或恢复默认".into(),
        _ => format!("背景文件不可读取：{e}"),
    })?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("请选择普通图片文件，不能使用符号链接".into());
    }
    let mut data = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take((limit + 1) as u64)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > limit {
        return Err("背景文件过大：图片最多 16 MiB".into());
    }
    Ok(data)
}
fn read_config(dir: &Path) -> Result<Config, String> {
    let path = dir.join(CONFIG);
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(e) => return Err(format!("无法读取背景设置：{e}")),
        _ => (),
    }
    let config: Config = serde_json::from_slice(&read_limited(&path, 16 * 1024)?)
        .map_err(|_| "背景设置损坏，请重试或恢复默认")?;
    if config.version != 1 || config.asset.as_ref().is_some_and(|s| !asset_name(s)) {
        return Err("背景设置格式无效，请恢复默认".into());
    }
    options(config.blur, config.mask)?;
    Ok(config)
}
fn write_config(dir: &Path, config: &Config) -> Result<(), String> {
    directory(dir)?;
    let mut temp =
        tempfile::NamedTempFile::new_in(dir).map_err(|e| format!("无法保存背景设置：{e}"))?;
    temp.write_all(&serde_json::to_vec(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(dir.join(CONFIG))
        .map_err(|e| format!("背景设置写入失败：{e}"))?;
    Ok(())
}
fn validate_image(data: &[u8]) -> Result<&'static str, String> {
    if data.len() > IMAGE_LIMIT {
        return Err("背景图片最多 16 MiB".into());
    }
    let format = image::guess_format(data).map_err(|_| "无法识别图片，仅支持 PNG、JPEG、WebP")?;
    let mime = match format {
        ImageFormat::Png => "image/png",
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::WebP => "image/webp",
        _ => return Err("仅支持 PNG、JPEG、WebP 静态背景".into()),
    };
    let (w, h) = ImageReader::with_format(Cursor::new(data), format)
        .into_dimensions()
        .map_err(|_| "图片损坏或无法读取尺寸")?;
    if w == 0 || h == 0 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 32_000_000 {
        return Err("背景图片单边最多 8192 像素，总像素最多 3200 万".into());
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut reader = ImageReader::with_format(Cursor::new(data), format);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "背景图片解码失败或超过内存限制")?;
    Ok(mime)
}
fn view(
    dir: &Path,
    config: &Config,
    cleanup_warning: Option<String>,
) -> Result<BackgroundView, String> {
    let image = match &config.asset {
        Some(asset) => {
            let data = read_limited(&dir.join(asset), IMAGE_LIMIT)?;
            let mime = validate_image(&data)?;
            Some(BackgroundImage {
                name: config.name.clone().unwrap_or_else(|| "自定义背景".into()),
                data_url: format!("data:{mime};base64,{}", STANDARD.encode(data)),
            })
        }
        None => None,
    };
    Ok(BackgroundView {
        blur: config.blur,
        mask: config.mask,
        image,
        cleanup_warning,
    })
}
// Remove only this feature's owned images after the manifest commits. Never follow links.
fn cleanup(dir: &Path, keep: Option<&str>) -> Option<String> {
    if !dir.exists() {
        return None;
    }
    let result = (|| -> Result<(), std::io::Error> {
        for item in fs::read_dir(dir)? {
            let item = item?;
            let name = item.file_name();
            let name = name.to_string_lossy();
            if asset_name(&name) && Some(name.as_ref()) != keep {
                fs::remove_file(item.path())?;
            }
        }
        Ok(())
    })();
    result
        .err()
        .map(|_| "设置已保存，但旧背景清理失败；下次启动或恢复默认时重试".into())
}
fn import_image(dir: &Path, source: &Path) -> Result<BackgroundView, String> {
    let data = read_limited(source, IMAGE_LIMIT)?;
    validate_image(&data)?;
    let mut config = read_config(dir)?;
    directory(dir)?;
    let mut temp = tempfile::Builder::new()
        .prefix("image-")
        .tempfile_in(dir)
        .map_err(|e| e.to_string())?;
    temp.write_all(&data).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    let (file, path) = temp.keep().map_err(|e| e.to_string())?;
    drop(file);
    config.asset = path.file_name().and_then(|s| s.to_str()).map(str::to_owned);
    config.name = Some(
        source
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .chars()
            .take(120)
            .collect(),
    );
    if let Err(error) = write_config(dir, &config) {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    let warning = cleanup(dir, config.asset.as_deref());
    view(dir, &config, warning)
}
fn update_options(dir: &Path, blur: u8, mask: u8) -> Result<(), String> {
    options(blur, mask)?;
    let mut config = read_config(dir)?;
    config.blur = blur;
    config.mask = mask;
    write_config(dir, &config)
}
fn reset(dir: &Path) -> Result<BackgroundView, String> {
    let config = Config::default();
    write_config(dir, &config)?;
    view(dir, &config, cleanup(dir, None))
}
fn background_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("background"))
}
#[tauri::command]
pub async fn load_background(app: tauri::AppHandle) -> Result<BackgroundView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<BackgroundIo>();
        let _lock = io.0.lock().map_err(|e| e.to_string())?;
        let dir = background_dir(&app)?;
        if dir.exists() {
            directory(&dir)?;
        }
        let config = read_config(&dir)?;
        let result = view(&dir, &config, None)?;
        Ok(BackgroundView {
            cleanup_warning: cleanup(&dir, config.asset.as_deref()),
            ..result
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn choose_background(app: tauri::AppHandle) -> Result<Option<BackgroundView>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<BackgroundIo>();
        let _lock = io.0.lock().map_err(|e| e.to_string())?;
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("背景图片", &["png", "jpg", "jpeg", "webp"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        import_image(
            &background_dir(&app)?,
            &file.into_path().map_err(|e| e.to_string())?,
        )
        .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn set_background_options(
    app: tauri::AppHandle,
    blur: u8,
    mask: u8,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<BackgroundIo>();
        let _lock = io.0.lock().map_err(|e| e.to_string())?;
        update_options(&background_dir(&app)?, blur, mask)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn reset_background(app: tauri::AppHandle) -> Result<BackgroundView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let io = app.state::<BackgroundIo>();
        let _lock = io.0.lock().map_err(|e| e.to_string())?;
        reset(&background_dir(&app)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png(path: &Path) -> Vec<u8> {
        let image = image::RgbImage::from_pixel(8, 6, image::Rgb([40, 90, 140]));
        image.save_with_format(path, ImageFormat::Png).unwrap();
        fs::read(path).unwrap()
    }
    #[test]
    fn imports_decodes_and_persists_png_jpeg_webp_independent_of_source() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("settings");
        for (format, name) in [
            (ImageFormat::Png, "中文 图片.png"),
            (ImageFormat::Jpeg, "photo.jpg"),
            (ImageFormat::WebP, "picture.webp"),
        ] {
            let path = temp.path().join(name);
            image::RgbImage::from_pixel(8, 6, image::Rgb([10, 90, 180]))
                .save_with_format(&path, format)
                .unwrap();
            let saved = import_image(&dir, &path).unwrap();
            assert_eq!(saved.image.unwrap().name, name);
            let config = read_config(&dir).unwrap();
            fs::remove_file(&path).unwrap();
            let loaded = view(&dir, &config, None).unwrap();
            assert!(loaded.image.unwrap().data_url.starts_with("data:image/"));
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        }
    }
    #[test]
    fn options_round_trip_keeps_image_and_reset_clears_only_owned_assets() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("settings");
        let source = temp.path().join("bg.png");
        png(&source);
        import_image(&dir, &source).unwrap();
        update_options(&dir, 24, 90).unwrap();
        let config = read_config(&dir).unwrap();
        assert_eq!((config.blur, config.mask), (24, 90));
        assert!(config.asset.is_some());
        fs::write(dir.join("keep.txt"), "untouched").unwrap();
        let result = reset(&dir).unwrap();
        assert!(result.image.is_none());
        assert_eq!((result.blur, result.mask), (6, 30));
        assert_eq!(read_config(&dir).unwrap(), Config::default());
        assert_eq!(
            fs::read_to_string(dir.join("keep.txt")).unwrap(),
            "untouched"
        );
        assert!(source.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    }
    #[test]
    fn invalid_import_and_option_ranges_leave_previous_background_intact() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("settings");
        let source = temp.path().join("bg.png");
        let data = png(&source);
        import_image(&dir, &source).unwrap();
        let before = fs::read(dir.join(CONFIG)).unwrap();
        fs::write(&source, b"not an image").unwrap();
        assert!(import_image(&dir, &source).is_err());
        assert!(update_options(&dir, 25, 30).is_err());
        assert!(update_options(&dir, 6, 91).is_err());
        assert_eq!(fs::read(dir.join(CONFIG)).unwrap(), before);
        let config = read_config(&dir).unwrap();
        assert_eq!(fs::read(dir.join(config.asset.unwrap())).unwrap(), data);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    }
    #[test]
    fn rejects_large_corrupt_unsupported_and_oversized_pixel_images() {
        assert!(validate_image(&vec![0; IMAGE_LIMIT + 1]).is_err());
        assert!(validate_image(b"GIF89a1234").is_err());
        assert!(validate_image(b"<svg/>").is_err());
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("bg.png");
        let data = png(&path);
        assert!(validate_image(&data[..data.len() / 2]).is_err());
        image::RgbImage::new(8193, 1).save(&path).unwrap();
        assert!(validate_image(&fs::read(&path).unwrap()).is_err());
    }
    #[test]
    fn preserves_broken_configuration_until_explicit_reset_and_rejects_missing_asset() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        fs::write(dir.join(CONFIG), b"broken").unwrap();
        assert!(read_config(dir).is_err());
        assert_eq!(fs::read(dir.join(CONFIG)).unwrap(), b"broken");
        reset(dir).unwrap();
        let config = Config {
            asset: Some("image-abcdef".into()),
            ..Config::default()
        };
        write_config(dir, &config).unwrap();
        assert!(view(dir, &read_config(dir).unwrap(), None).is_err());
        let invalid = Config {
            asset: Some("../outside.png".into()),
            ..Config::default()
        };
        write_config(dir, &invalid).unwrap();
        assert!(read_config(dir).is_err());
        reset(dir).unwrap();
        assert!(view(dir, &read_config(dir).unwrap(), None)
            .unwrap()
            .image
            .is_none());
        fs::remove_file(dir.join(CONFIG)).unwrap();
        fs::create_dir(dir.join(CONFIG)).unwrap();
        assert!(write_config(dir, &Config::default()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_managed_symlinks_and_cleanup_never_follows_them() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.png");
        png(&source);
        let dir = temp.path().join("settings");
        fs::create_dir(&dir).unwrap();
        symlink(&source, dir.join("image-abcdef")).unwrap();
        let config = Config {
            asset: Some("image-abcdef".into()),
            ..Config::default()
        };
        assert!(view(&dir, &config, None).is_err());
        assert!(cleanup(&dir, None).is_none());
        assert!(source.exists());
        symlink(&source, dir.join(CONFIG)).unwrap();
        assert!(read_config(&dir).is_err());
        let alias = temp.path().join("alias");
        symlink(&dir, &alias).unwrap();
        assert!(directory(&alias).is_err());
    }
}
