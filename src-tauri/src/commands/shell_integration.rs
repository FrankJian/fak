//! 外壳集成（SPEC §12.4）。
//!
//! Windows：ProgID + 右键菜单 + 「打开方式」列表 + RegisteredApplications。
//! macOS 走 bundle 内的 `fileAssociations` 声明，不需要运行时注册，因此这里是空实现。
//!
//! **全部写在 HKCU 下，不碰 HKLM，因此不需要管理员权限**（SPEC §12.3.4：绝不提权）。
//! 注册是用户显式动作，不在启动时自动执行——悄悄改系统关联是流氓软件行为。

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::error::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    pub registered: bool,
    /// 平台是否支持运行时注册。不支持时设置界面隐藏这一项
    pub supported: bool,
}

#[tauri::command]
pub fn shell_integration_status() -> ShellIntegrationStatus {
    #[cfg(windows)]
    {
        ShellIntegrationStatus {
            registered: windows_impl::is_registered(),
            supported: true,
        }
    }
    #[cfg(not(windows))]
    {
        ShellIntegrationStatus {
            registered: false,
            supported: false,
        }
    }
}

#[tauri::command]
pub fn register_shell_integration<R: Runtime>(
    app: AppHandle<R>,
    menu_label: String,
) -> AppResult<()> {
    #[cfg(windows)]
    {
        windows_impl::register(&app, &menu_label)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, menu_label);
        Ok(())
    }
}

#[tauri::command]
pub fn unregister_shell_integration<R: Runtime>(app: AppHandle<R>) -> AppResult<()> {
    #[cfg(windows)]
    {
        windows_impl::unregister(&app)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::path::PathBuf;

    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Manager, Runtime};
    use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS, KEY_READ};
    use winreg::RegKey;

    use crate::error::{AppError, AppResult};

    const PROG_ID: &str = "Fak.Document";
    const APP_NAME: &str = "Fak";
    const LEDGER_FILE: &str = "shell-integration.json";

    /// SPEC §12.4 指定的关联扩展名。
    const EXTENSIONS: &[&str] = &[
        "txt", "md", "log", "json", "yaml", "yml", "toml", "xml", "ini", "conf",
    ];

    /// 右键菜单挂载点：文件、目录、目录空白处。
    const CONTEXT_MENU_ROOTS: &[&str] = &[
        r"Software\Classes\*\shell\Fak",
        r"Software\Classes\Directory\shell\Fak",
        r"Software\Classes\Directory\Background\shell\Fak",
    ];

    /// 注册时留下的账本。
    ///
    /// 没有它，「还原」就只能靠猜哪些键是我们建的——删错了会破坏用户其他程序的关联。
    #[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub(super) struct Ledger {
        /// 我们创建的键，还原时整棵删掉
        created_keys: Vec<String>,
        /// 写入前已存在的默认值，还原时写回
        previous_defaults: Vec<(String, String)>,
    }

    fn io(error: std::io::Error) -> AppError {
        AppError::Io {
            os_code: error.raw_os_error(),
        }
    }

    fn ledger_path<R: Runtime>(app: &AppHandle<R>) -> AppResult<PathBuf> {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|_| AppError::Io { os_code: None })?;
        std::fs::create_dir_all(&directory)
            .map_err(|error| AppError::from_io(&error, &directory))?;
        Ok(directory.join(LEDGER_FILE))
    }

    pub(super) fn exe_command() -> AppResult<String> {
        let exe = std::env::current_exe().map_err(|error| AppError::from_io(&error, "fak"))?;
        Ok(format!("\"{}\" \"%1\"", exe.display()))
    }

    pub(super) fn exe_icon() -> AppResult<String> {
        let exe = std::env::current_exe().map_err(|error| AppError::from_io(&error, "fak"))?;
        Ok(format!("\"{}\",0", exe.display()))
    }

    /// 目录空白处传的是当前目录，占位符与文件不同。
    pub(super) fn background_command(command: &str) -> String {
        command.replace("\"%1\"", "\"%V\"")
    }

    /// 不通知的话，右键菜单要等重启资源管理器才出现。
    fn notify_association_changed() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        // SAFETY: SHCNE_ASSOCCHANGED 不使用后两个指针参数，按文档传空。
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
    }

    pub(super) fn is_registered() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(format!(r"Software\Classes\{PROG_ID}"), KEY_READ)
            .is_ok()
    }

    pub(super) fn register<R: Runtime>(app: &AppHandle<R>, menu_label: &str) -> AppResult<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let command = exe_command()?;
        let icon = exe_icon()?;
        let mut ledger = Ledger::default();

        let progid_root = format!(r"Software\Classes\{PROG_ID}");
        let (progid, _) = hkcu.create_subkey(&progid_root).map_err(io)?;
        progid.set_value("", &"Fak Document").map_err(io)?;
        let (progid_command, _) = hkcu
            .create_subkey(format!(r"{progid_root}\shell\open\command"))
            .map_err(io)?;
        progid_command.set_value("", &command).map_err(io)?;
        ledger.created_keys.push(progid_root);

        // 只往「打开方式」列表里加，**不改 .ext 的默认值**：
        // Win10 起默认程序归系统 UI 管，程序化抢占会被重置，还惹恼用户
        for ext in EXTENSIONS {
            let ext_root = format!(r"Software\Classes\.{ext}");
            if let Ok(existing) = hkcu.open_subkey_with_flags(&ext_root, KEY_READ) {
                if let Ok(value) = existing.get_value::<String, _>("") {
                    ledger.previous_defaults.push((ext_root.clone(), value));
                }
            }
            let (progids, _) = hkcu
                .create_subkey(format!(r"{ext_root}\OpenWithProgids"))
                .map_err(io)?;
            // 值本身无意义，键存在即代表「这个 ProgID 能打开该扩展名」
            progids.set_value(PROG_ID, &"").map_err(io)?;
        }

        for root in CONTEXT_MENU_ROOTS {
            let (menu, _) = hkcu.create_subkey(root).map_err(io)?;
            menu.set_value("", &menu_label).map_err(io)?;
            menu.set_value("Icon", &icon).map_err(io)?;
            let (menu_command, _) = hkcu.create_subkey(format!(r"{root}\command")).map_err(io)?;
            let target = if root.contains("Background") {
                background_command(&command)
            } else {
                command.clone()
            };
            menu_command.set_value("", &target).map_err(io)?;
            ledger.created_keys.push((*root).to_string());
        }

        let capabilities_root = format!(r"Software\{APP_NAME}\Capabilities");
        let (capabilities, _) = hkcu.create_subkey(&capabilities_root).map_err(io)?;
        capabilities
            .set_value("ApplicationName", &APP_NAME)
            .map_err(io)?;
        capabilities
            .set_value("ApplicationDescription", &"Fast text editor")
            .map_err(io)?;
        let (file_associations, _) = hkcu
            .create_subkey(format!(r"{capabilities_root}\FileAssociations"))
            .map_err(io)?;
        for ext in EXTENSIONS {
            file_associations
                .set_value(format!(".{ext}"), &PROG_ID)
                .map_err(io)?;
        }
        let (registered, _) = hkcu
            .create_subkey(r"Software\RegisteredApplications")
            .map_err(io)?;
        registered
            .set_value(APP_NAME, &capabilities_root)
            .map_err(io)?;
        ledger.created_keys.push(format!(r"Software\{APP_NAME}"));

        let path = ledger_path(app)?;
        let encoded =
            serde_json::to_vec_pretty(&ledger).map_err(|_| AppError::Io { os_code: None })?;
        std::fs::write(&path, encoded).map_err(|error| AppError::from_io(&error, &path))?;

        notify_association_changed();
        log::info!("已注册外壳集成（{} 个扩展名）", EXTENSIONS.len());
        Ok(())
    }

    pub(super) fn unregister<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = ledger_path(app)?;
        let ledger: Ledger = std::fs::read(&path)
            .ok()
            .and_then(|raw| serde_json::from_slice(&raw).ok())
            .unwrap_or_default();

        for key in &ledger.created_keys {
            let _ = hkcu.delete_subkey_all(key);
        }

        // OpenWithProgids 是用户原有的键，只摘掉我们加的那一项，不能整个删
        for ext in EXTENSIONS {
            if let Ok(progids) = hkcu.open_subkey_with_flags(
                format!(r"Software\Classes\.{ext}\OpenWithProgids"),
                KEY_ALL_ACCESS,
            ) {
                let _ = progids.delete_value(PROG_ID);
            }
        }

        for (key, value) in &ledger.previous_defaults {
            if let Ok(existing) = hkcu.open_subkey_with_flags(key, KEY_ALL_ACCESS) {
                let _ = existing.set_value("", value);
            }
        }

        if let Ok(registered) =
            hkcu.open_subkey_with_flags(r"Software\RegisteredApplications", KEY_ALL_ACCESS)
        {
            let _ = registered.delete_value(APP_NAME);
        }

        let _ = std::fs::remove_file(&path);
        notify_association_changed();
        log::info!("已还原外壳集成");
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::windows_impl::*;

    #[test]
    fn 命令行把路径完整引起来() {
        let command = exe_command().expect("当前可执行文件");
        assert!(command.ends_with(r#" "%1""#), "要带占位符：{command}");
        assert!(
            command.starts_with('"'),
            "路径含空格时必须有引号：{command}"
        );
    }

    #[test]
    fn 目录空白处换成_v_占位符() {
        assert_eq!(
            background_command(r#""C:\fak.exe" "%1""#),
            r#""C:\fak.exe" "%V""#
        );
    }

    #[test]
    fn 图标指向可执行文件的第一个资源() {
        assert!(exe_icon().expect("图标").ends_with(",0"));
    }
}
