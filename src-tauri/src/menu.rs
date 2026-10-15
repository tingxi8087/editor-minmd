use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Runtime,
};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let action = |id: &str, title: &str, shortcut: Option<&str>| {
        MenuItem::with_id(app, id, title, true, shortcut)
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "MinMD",
                true,
                &[
                    &PredefinedMenuItem::about(app, Some("关于 MinMD"), None)?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::services(app, Some("服务"))?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::hide(app, Some("隐藏 MinMD"))?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &action("quit", "退出 MinMD", Some("CmdOrCtrl+Q"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &action("new", "新建 MD", Some("CmdOrCtrl+N"))?,
                    &action("new-text", "新建文本", Some("CmdOrCtrl+Shift+N"))?,
                    &action("open", "打开文件…", Some("CmdOrCtrl+O"))?,
                    &action("directory", "打开目录…", Some("CmdOrCtrl+Shift+O"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &action("save", "保存", Some("CmdOrCtrl+S"))?,
                    &action("save-as", "另存为…", Some("CmdOrCtrl+Shift+S"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &action("close-tab", "关闭标签", Some("CmdOrCtrl+W"))?,
                    &action("close-others", "关闭其他标签", None)?,
                    &action("close-window", "关闭窗口", Some("CmdOrCtrl+Shift+W"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("撤销"))?,
                    &PredefinedMenuItem::redo(app, Some("重做"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("剪切"))?,
                    &PredefinedMenuItem::copy(app, Some("复制"))?,
                    &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                    &PredefinedMenuItem::select_all(app, Some("全选"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "窗口",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some("最小化"))?,
                    &PredefinedMenuItem::maximize(app, Some("缩放"))?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::fullscreen(app, Some("切换全屏"))?,
                ],
            )?,
        ],
    )
}

pub fn dispatch<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let _ = app.emit("workspace-command", event.id().as_ref());
}
