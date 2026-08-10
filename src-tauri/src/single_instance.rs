//! 单实例开关的启动期读取（SPEC §12.5）。
//!
//! 插件必须在 `tauri::Builder` 之前注册，那时配置系统还没起来，所以这里
//! 直接读一次 `config.json`。**这是全项目唯一在 Builder 之前碰配置文件的地方**。
//!
//! 读失败一律当作「开启」：单实例是默认行为，读不到配置时按默认走，
//! 比因为一个读不出来的开关而退化成多实例要合理。

use std::path::Path;

use crate::config::CONFIG_FILE;

const KEY: &str = "singleInstance";

/// 启动时实际生效的单实例状态。设置里改了之后要重启才生效，
/// 前端拿它和配置值比对，好在界面上明确提示（SPEC §12.5 第 3 条）。
pub struct SingleInstanceActive(pub bool);

/// 本次启动实际生效的值，不是配置里的值——两者不一致就说明改过但没重启。
#[tauri::command]
pub fn single_instance_active(state: tauri::State<'_, SingleInstanceActive>) -> bool {
    state.0
}

pub fn preference(config_dir: &Path) -> bool {
    read_flag(&config_dir.join(CONFIG_FILE)).unwrap_or(true)
}

fn read_flag(path: &Path) -> Option<bool> {
    let raw = std::fs::read(path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    value.get(KEY)?.as_bool()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, body: &str) {
        std::fs::write(dir.join(CONFIG_FILE), body).expect("写配置");
    }

    #[test]
    fn 读得出显式关闭() {
        let dir = tempfile::tempdir().expect("临时目录");
        write(dir.path(), r#"{"singleInstance": false}"#);
        assert!(!preference(dir.path()));
    }

    #[test]
    fn 读得出显式开启() {
        let dir = tempfile::tempdir().expect("临时目录");
        write(dir.path(), r#"{"singleInstance": true}"#);
        assert!(preference(dir.path()));
    }

    #[test]
    fn 配置不存在时按默认开启() {
        let dir = tempfile::tempdir().expect("临时目录");
        assert!(preference(dir.path()));
    }

    #[test]
    fn 配置损坏时按默认开启而不是崩掉() {
        let dir = tempfile::tempdir().expect("临时目录");
        write(dir.path(), "{ 这不是 json");
        assert!(preference(dir.path()));
    }

    #[test]
    fn 字段类型不对时按默认开启() {
        let dir = tempfile::tempdir().expect("临时目录");
        write(dir.path(), r#"{"singleInstance": "yes"}"#);
        assert!(preference(dir.path()));
    }
}
