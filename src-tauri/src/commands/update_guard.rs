//! 更新安装的前置 / 后置闸门（SPEC §12.3.4、P6-04）。
//!
//! Tauri updater 插件自己会校验 minisign 签名，**这里绝不提供任何绕过入口**。
//! 本模块补的是插件不管的那几件事：目标目录能不能写、是不是从挂载卷里自我更新、
//! 装完的结果怎么让用户下次启动时看到。
//!
//! 路径只在 Rust 侧流转，回传前端的只有布尔量与 basename（SPEC §10.2）。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{path_hint, AppError, AppResult};

/// 结果文件超过这个时长就当作过期，不再打扰用户（SPEC §12.3.4 第 6 条）。
const OUTCOME_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1000;

const OUTCOME_FILE: &str = "update-outcome.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPreflight {
    /// 目标目录可写。不可写时前端引导手动下载，**绝不请求提权**
    pub writable: bool,
    /// macOS：应用正从挂载卷（如 DMG）里运行，自我更新会写到只读介质上
    pub running_from_mount: bool,
    /// 只给 basename，完整路径不进 IPC 负载
    pub target_hint: String,
}

/// 应用自身所在目录。macOS 上要退到 `.app` 之外——真正被替换的是整个 bundle，
/// 而不是 `Contents/MacOS` 里的可执行文件。
fn install_root(exe: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        // <root>/Fak.app/Contents/MacOS/fak → <root>
        if let Some(bundle) = exe
            .ancestors()
            .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        {
            if let Some(parent) = bundle.parent() {
                return parent.to_path_buf();
            }
        }
    }
    exe.parent().unwrap_or(exe).to_path_buf()
}

/// 真去建一个临时文件来判定可写性。
///
/// 不看权限位：Windows 的 ACL、macOS 的 SIP、只读挂载各有各的表现，
/// 只有实际写一次才作数。
fn is_writable(directory: &Path) -> bool {
    let probe = directory.join(format!(".fak-write-probe-{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// macOS 把 DMG 挂到 `/Volumes` 下。从那里自我更新必然失败，
/// 而且失败得很晚（下载完才发现），不如一开始就拦住。
fn is_mounted_volume(path: &Path) -> bool {
    cfg!(target_os = "macos") && path.starts_with("/Volumes")
}

#[tauri::command]
pub fn update_install_preflight() -> AppResult<InstallPreflight> {
    let exe = std::env::current_exe().map_err(|error| AppError::from_io(&error, "fak"))?;
    let root = install_root(&exe);
    Ok(InstallPreflight {
        writable: is_writable(&root),
        running_from_mount: is_mounted_volume(&exe),
        target_hint: path_hint(&root),
    })
}

/// macOS 从网络下载的 bundle 带 `com.apple.quarantine`，不清掉会被 Gatekeeper 拦下。
/// 本应用不做公证，这一步是装完还能正常启动的前提。
#[tauri::command]
pub fn clear_quarantine_attributes() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|error| AppError::from_io(&error, "fak"))?;
        let bundle = exe
            .ancestors()
            .find(|path| path.extension().is_some_and(|ext| ext == "app"))
            .unwrap_or(&exe);
        // 参数数组传递，不拼 shell 字符串（AGENTS.md §5.1）
        std::process::Command::new("/usr/bin/xattr")
            .arg("-cr")
            .arg(bundle)
            .status()
            .map_err(|error| AppError::from_io(&error, "xattr"))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcome {
    /// 尝试安装的目标版本
    pub version: String,
    pub recorded_at: u64,
}

/// 读回时的判定结果。成功与否靠「当前跑的版本是不是当初要装的那个」推断——
/// 安装进程会替换掉自己，没有别的可靠回执。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcomeReport {
    pub version: String,
    pub succeeded: bool,
}

fn outcome_path<R: Runtime>(app: &AppHandle<R>) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| AppError::Io { os_code: None })?;
    std::fs::create_dir_all(&directory).map_err(|error| AppError::from_io(&error, &directory))?;
    Ok(directory.join(OUTCOME_FILE))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

/// 安装前落一条记录。装成功的话进程已经是新版本，这条记录就成了成功凭据；
/// 装失败（或根本没装上）则下次启动仍是旧版本，据此报失败。
#[tauri::command]
pub fn record_update_attempt<R: Runtime>(app: AppHandle<R>, version: String) -> AppResult<()> {
    let outcome = UpdateOutcome {
        version,
        recorded_at: now_ms(),
    };
    let path = outcome_path(&app)?;
    let encoded =
        serde_json::to_vec_pretty(&outcome).map_err(|_| AppError::Io { os_code: None })?;
    std::fs::write(&path, encoded).map_err(|error| AppError::from_io(&error, &path))
}

/// 启动时取一次。成功状态读取后即清除；失败保留到过期，
/// 免得用户重启一次就再也看不到「上次更新没装上」。
#[tauri::command]
pub fn take_update_outcome<R: Runtime>(
    app: AppHandle<R>,
) -> AppResult<Option<UpdateOutcomeReport>> {
    let path = outcome_path(&app)?;
    let Ok(raw) = std::fs::read(&path) else {
        return Ok(None);
    };
    let Ok(outcome) = serde_json::from_slice::<UpdateOutcome>(&raw) else {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    };

    if now_ms().saturating_sub(outcome.recorded_at) > OUTCOME_TTL_MS {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }

    let succeeded = app.package_info().version.to_string() == outcome.version;
    if succeeded {
        let _ = std::fs::remove_file(&path);
    }
    Ok(Some(UpdateOutcomeReport {
        version: outcome.version,
        succeeded,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 可写性靠实际写入判定而不是权限位() {
        let dir = tempfile::tempdir().expect("临时目录");
        assert!(is_writable(dir.path()));
        assert!(!is_writable(&dir.path().join("not-there")));
    }

    #[test]
    fn 探针文件用完即删不留垃圾() {
        let dir = tempfile::tempdir().expect("临时目录");
        assert!(is_writable(dir.path()));
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .expect("读目录")
            .filter_map(Result::ok)
            .collect();
        assert!(leftovers.is_empty(), "探针文件必须删干净");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn 挂载卷上的应用被识别出来() {
        assert!(is_mounted_volume(Path::new("/Volumes/Fak/Fak.app")));
        assert!(!is_mounted_volume(Path::new("/Applications/Fak.app")));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn 非_macos_不做挂载卷判定() {
        assert!(!is_mounted_volume(Path::new("/Volumes/Fak/Fak.app")));
    }

    #[test]
    fn 安装根目录是可执行文件所在目录() {
        let exe = if cfg!(windows) {
            PathBuf::from(r"C:\Program Files\Fak\fak.exe")
        } else {
            PathBuf::from("/usr/local/bin/fak")
        };
        assert_eq!(install_root(&exe), exe.parent().expect("父目录"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_安装根目录退到_app_之外() {
        let exe = Path::new("/Applications/Fak.app/Contents/MacOS/fak");
        assert_eq!(install_root(exe), Path::new("/Applications"));
    }
}
