//! macOS / Windows 原生应用菜单。
//!
//! 菜单项 id 与前端 `actionRegistry` 的 id 完全一致。Rust 只负责让操作系统
//! 绘制菜单并发送 id，动作的启用条件与执行逻辑仍只有前端注册表一处真相源。

use crate::config::{Config, Language};
use tauri::menu::{
    AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
    HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::Emitter;

pub const NATIVE_MENU_ACTION_EVENT: &str = "app://native-menu-action";

const ACTION_IDS: &[&str] = &[
    "file.new",
    "file.open",
    "file.openFolder",
    "file.save",
    "file.saveAs",
    "file.closeTab",
    "file.settings",
    "edit.undo",
    "edit.redo",
    "view.quickAccessBar",
    "view.markdownPreview",
    "view.commandPalette",
    "help.checkForUpdates",
];

#[derive(Clone, Copy)]
struct Labels {
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    help: &'static str,
    new_file: &'static str,
    open_file: &'static str,
    open_folder: &'static str,
    save: &'static str,
    save_as: &'static str,
    close_tab: &'static str,
    settings: &'static str,
    undo: &'static str,
    redo: &'static str,
    quick_access_bar: &'static str,
    markdown_preview: &'static str,
    command_palette: &'static str,
    check_updates: &'static str,
    about: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    minimize: &'static str,
    maximize: &'static str,
    close_window: &'static str,
}

impl Labels {
    fn for_language(language: Language) -> Self {
        match language {
            Language::ZhCn => Self {
                file: "文件",
                edit: "编辑",
                view: "视图",
                window: "窗口",
                help: "帮助",
                new_file: "新建文件",
                open_file: "打开文件…",
                open_folder: "打开文件夹…",
                save: "保存",
                save_as: "另存为…",
                close_tab: "关闭标签页",
                settings: "设置…",
                undo: "撤销",
                redo: "重做",
                quick_access_bar: "显示快捷栏",
                markdown_preview: "Markdown 预览",
                command_palette: "命令面板…",
                check_updates: "检查更新…",
                about: "关于 Fak",
                hide: "隐藏 Fak",
                hide_others: "隐藏其他窗口",
                show_all: "全部显示",
                quit: "退出 Fak",
                minimize: "最小化",
                maximize: "最大化",
                close_window: "关闭窗口",
            },
            Language::EnUs => Self {
                file: "File",
                edit: "Edit",
                view: "View",
                window: "Window",
                help: "Help",
                new_file: "New File",
                open_file: "Open File…",
                open_folder: "Open Folder…",
                save: "Save",
                save_as: "Save As…",
                close_tab: "Close Tab",
                settings: "Settings…",
                undo: "Undo",
                redo: "Redo",
                quick_access_bar: "Show Quick Access Bar",
                markdown_preview: "Markdown Preview",
                command_palette: "Command Palette…",
                check_updates: "Check for Updates…",
                about: "About Fak",
                hide: "Hide Fak",
                hide_others: "Hide Others",
                show_all: "Show All",
                quit: "Quit Fak",
                minimize: "Minimize",
                maximize: "Maximize",
                close_window: "Close Window",
            },
        }
    }
}

fn item<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<R>> {
    let builder = MenuItemBuilder::with_id(id, text);
    match accelerator {
        Some(value) => builder.accelerator(value).build(app),
        None => builder.build(app),
    }
}

pub fn install_on_handle(app: &tauri::AppHandle, config: &Config) -> tauri::Result<()> {
    let labels = Labels::for_language(config.language);

    let new_file = item(app, "file.new", labels.new_file, Some("CmdOrCtrl+N"))?;
    let open_file = item(app, "file.open", labels.open_file, Some("CmdOrCtrl+O"))?;
    let open_folder = item(app, "file.openFolder", labels.open_folder, None)?;
    let save = item(app, "file.save", labels.save, Some("CmdOrCtrl+S"))?;
    let save_as = item(
        app,
        "file.saveAs",
        labels.save_as,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let close_tab = item(app, "file.closeTab", labels.close_tab, Some("CmdOrCtrl+W"))?;
    let settings = item(
        app,
        "file.settings",
        labels.settings,
        Some("CmdOrCtrl+Comma"),
    )?;
    let undo = item(app, "edit.undo", labels.undo, Some("CmdOrCtrl+Z"))?;
    let redo_accelerator = if cfg!(target_os = "macos") {
        "CmdOrCtrl+Shift+Z"
    } else {
        "Ctrl+Y"
    };
    let redo = item(app, "edit.redo", labels.redo, Some(redo_accelerator))?;
    let quick_access =
        CheckMenuItemBuilder::with_id("view.quickAccessBar", labels.quick_access_bar)
            .checked(config.quick_access_bar_visible)
            .build(app)?;
    let markdown_preview = item(app, "view.markdownPreview", labels.markdown_preview, None)?;
    let command_palette = item(
        app,
        "view.commandPalette",
        labels.command_palette,
        Some("CmdOrCtrl+Shift+P"),
    )?;
    let check_updates = item(app, "help.checkForUpdates", labels.check_updates, None)?;

    let mut file_builder = SubmenuBuilder::new(app, labels.file)
        .item(&new_file)
        .item(&open_file)
        .item(&open_folder)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&close_tab);
    if !cfg!(target_os = "macos") {
        file_builder = file_builder.separator().item(&settings);
    }
    let file_menu = file_builder.build()?;

    let edit_menu = SubmenuBuilder::new(app, labels.edit)
        .item(&undo)
        .item(&redo)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, labels.view)
        .item(&quick_access)
        .separator()
        .item(&markdown_preview)
        .item(&command_palette)
        .build()?;
    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, labels.window)
        .minimize_with_text(labels.minimize)
        .maximize_with_text(labels.maximize)
        .separator()
        .close_window_with_text(labels.close_window)
        .build()?;

    let mut help_builder =
        SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, labels.help).item(&check_updates);
    if !cfg!(target_os = "macos") {
        help_builder = help_builder
            .separator()
            .about_with_text(labels.about, Some(AboutMetadata::default()));
    }
    let help_menu = help_builder.build()?;

    let mut menu_builder = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "Fak")
            .about_with_text(labels.about, Some(AboutMetadata::default()))
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide_with_text(labels.hide)
            .hide_others_with_text(labels.hide_others)
            .show_all_with_text(labels.show_all)
            .separator()
            .quit_with_text(labels.quit)
            .build()?;
        menu_builder = menu_builder.item(&app_menu);
    }

    let menu = menu_builder
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn emit_action(app: &tauri::AppHandle, id: &tauri::menu::MenuId) {
    let id = id.as_ref();
    if ACTION_IDS.contains(&id) && app.emit(NATIVE_MENU_ACTION_EVENT, id).is_err() {
        log::warn!("系统菜单动作发送失败");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_follow_the_configured_language() {
        assert_eq!(Labels::for_language(Language::ZhCn).file, "文件");
        assert_eq!(Labels::for_language(Language::EnUs).file, "File");
        assert_eq!(Labels::for_language(Language::ZhCn).settings, "设置…");
        assert_eq!(Labels::for_language(Language::EnUs).settings, "Settings…");
    }

    #[test]
    fn every_forwarded_id_uses_the_frontend_action_namespace() {
        assert!(ACTION_IDS.iter().all(|id| id.contains('.')));
        assert!(ACTION_IDS.contains(&"view.quickAccessBar"));
    }
}
