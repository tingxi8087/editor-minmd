use serde::Serialize;
use std::{collections::VecDeque, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

pub const EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "text", "json", "yaml", "yml", "toml", "ini", "xml", "csv", "log",
    "js", "jsx", "ts", "tsx", "html", "css", "scss", "less", "py", "rs", "go", "java", "c", "h",
    "cpp", "hpp", "sh", "sql", "vue", "svelte",
];
#[derive(Default)]
pub struct PendingFiles(Mutex<VecDeque<PathBuf>>);

pub fn enqueue(app: &tauri::AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    if let Ok(mut pending) = app.state::<PendingFiles>().0.lock() {
        for path in paths {
            if !pending.contains(&path) {
                pending.push_back(path);
            }
        }
    }
    let _ = app.emit("external-files-pending", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingFile {
    file: Option<crate::DocumentFile>,
    error: Option<String>,
}
#[tauri::command]
pub fn take_external_files(app: tauri::AppHandle) -> Result<Vec<IncomingFile>, String> {
    let paths: Vec<_> = app
        .state::<PendingFiles>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .drain(..)
        .collect();
    Ok(paths
        .into_iter()
        .map(|path| {
            let result = path
                .canonicalize()
                .map_err(|e| format!("{}：{e}", path.display()))
                .and_then(|path| {
                    let file = crate::read_document(&path)?;
                    app.state::<crate::OpenedFiles>()
                        .0
                        .lock()
                        .map_err(|e| e.to_string())?
                        .insert(path);
                    Ok(file)
                });
            match result {
                Ok(file) => IncomingFile {
                    file: Some(file),
                    error: None,
                },
                Err(error) => IncomingFile {
                    file: None,
                    error: Some(error),
                },
            }
        })
        .collect())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationResult {
    extension: String,
    content_type: Option<String>,
    success: bool,
    message: String,
}
fn validate(extensions: &[String]) -> Result<(), String> {
    if extensions.is_empty() {
        return Err("请至少选择一种文件类型".into());
    }
    if extensions
        .iter()
        .any(|ext| !EXTENSIONS.contains(&ext.as_str()))
    {
        return Err("包含不支持的文件类型".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn set_default_associations(
    app: tauri::AppHandle,
    extensions: Vec<String>,
) -> Result<Vec<AssociationResult>, String> {
    validate(&extensions)?;
    tauri::async_runtime::spawn_blocking(move || platform::apply(&app, extensions))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn association_platform() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn apply(
        _: &tauri::AppHandle,
        _: Vec<String>,
    ) -> Result<Vec<super::AssociationResult>, String> {
        Err("默认打开方式目前仅支持 macOS".into())
    }
}
#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use core_foundation::{
        base::{CFRelease, TCFType},
        string::{CFString, CFStringRef},
        url::{CFURLRef, CFURL},
    };
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSRegisterURL(url: CFURLRef, update: u8) -> i32;
        fn UTTypeCreatePreferredIdentifierForTag(
            class: CFStringRef,
            tag: CFStringRef,
            conforms: CFStringRef,
        ) -> CFStringRef;
        fn UTTypeConformsTo(kind: CFStringRef, parent: CFStringRef) -> u8;
        fn LSSetDefaultRoleHandlerForContentType(
            kind: CFStringRef,
            roles: u32,
            bundle: CFStringRef,
        ) -> i32;
        fn LSCopyDefaultRoleHandlerForContentType(kind: CFStringRef, roles: u32) -> CFStringRef;
    }
    pub fn content_type(ext: &str) -> Result<CFString, String> {
        let tag = CFString::new("public.filename-extension");
        let ext = CFString::new(ext);
        let value = unsafe {
            UTTypeCreatePreferredIdentifierForTag(
                tag.as_concrete_TypeRef(),
                ext.as_concrete_TypeRef(),
                std::ptr::null(),
            )
        };
        if value.is_null() {
            return Err("系统无法识别此文件类型".into());
        }
        Ok(unsafe { CFString::wrap_under_create_rule(value) })
    }
    pub fn apply(
        app: &tauri::AppHandle,
        extensions: Vec<String>,
    ) -> Result<Vec<AssociationResult>, String> {
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let bundle_path = executable
            .ancestors()
            .nth(3)
            .filter(|p| p.extension().is_some_and(|e| e == "app"))
            .ok_or("请从已构建的 editor-minmd.app 中设置默认打开方式，建议先将应用放入「应用程序」")?;
        let url = CFURL::from_path(bundle_path, true).ok_or("无法取得应用位置")?;
        let status = unsafe { LSRegisterURL(url.as_concrete_TypeRef(), 1) };
        if status != 0 {
            return Err(format!("应用注册失败（macOS {status}）"));
        }
        let bundle = CFString::new(&app.config().identifier);
        Ok(extensions.into_iter().map(|extension| {
            let mut row = AssociationResult { extension: extension.clone(), content_type: None, success: false, message: String::new() };
            match content_type(&extension) {
                Err(error) => row.message = error,
                Ok(kind) => {
                    row.content_type = Some(kind.to_string());
                    let text = CFString::new("public.text");
                    if unsafe { UTTypeConformsTo(kind.as_concrete_TypeRef(), text.as_concrete_TypeRef()) } == 0 {
                        row.message = format!("系统将此扩展名识别为 {}，未修改非文本类型的关联；请使用访达右键「打开方式」选择 editor-minmd", kind);
                        return row;
                    }
                    let status = unsafe { LSSetDefaultRoleHandlerForContentType(kind.as_concrete_TypeRef(), u32::MAX, bundle.as_concrete_TypeRef()) };
                    let current = unsafe { LSCopyDefaultRoleHandlerForContentType(kind.as_concrete_TypeRef(), u32::MAX) };
                    let matches = if current.is_null() { false } else {
                        let matches = unsafe { CFString::wrap_under_get_rule(current) }.to_string().eq_ignore_ascii_case(&app.config().identifier);
                        unsafe { CFRelease(current.cast()) }; matches
                    };
                    row.success = status == 0 && matches;
                    row.message = if row.success { "已设为默认".into() } else if status == 0 { "尚未生效，请确认系统提示后重试，或在访达「显示简介 → 打开方式 → 全部更改」中设置".into() } else { format!("设置失败（macOS {status}），可在访达「显示简介 → 打开方式 → 全部更改」中设置") };
                }
            }
            row
        }).collect())
    }
    #[test]
    fn resolves_supported_types_without_changing_defaults() {
        for extension in EXTENSIONS {
            let kind = content_type(extension).unwrap().to_string();
            let current = unsafe {
                LSCopyDefaultRoleHandlerForContentType(
                    content_type(extension).unwrap().as_concrete_TypeRef(),
                    u32::MAX,
                )
            };
            let handler = if current.is_null() {
                String::new()
            } else {
                unsafe { CFString::wrap_under_create_rule(current) }.to_string()
            };
            println!("{extension}: {kind} -> {handler}");
            assert!(!kind.is_empty());
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_or_unlisted_types() {
        assert!(validate(&[]).is_err());
        assert!(validate(&["exe".into()]).is_err());
        assert!(validate(&["md".into(), "txt".into()]).is_ok());
    }
}
