//! 配置目录解析（SPEC §9.5）。
//!
//! 存在的唯一理由：**单实例插件必须在 `tauri::Builder` 之前注册**，而那时还没有
//! `AppHandle`，`app.path().app_config_dir()` 用不了。
//!
//! 为了不出现「两处路径逻辑分歧」这种隐形 bug，`setup()` 里也走这个函数，
//! 而不是各算各的。identifier 一律从 `generate_context!()` 拿，不硬编码。

use std::path::PathBuf;

/// 与 Tauri `PathResolver::app_config_dir()` 同构：平台配置目录 + identifier。
/// 两者都是 `dirs::config_dir()`，所以不会分叉。
pub fn app_config_dir(identifier: &str) -> Option<PathBuf> {
    dirs::config_dir().map(|base| base.join(identifier))
}

/// 取不到平台配置目录时的退路：配置不持久，但应用可用（SPEC §9.3 第 1 条）。
pub fn app_config_dir_or_temp(identifier: &str) -> PathBuf {
    app_config_dir(identifier).unwrap_or_else(|| std::env::temp_dir().join("fak-config"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 配置目录以_identifier_结尾() {
        let dir = app_config_dir("com.fak.editor").expect("平台配置目录");
        assert!(dir.ends_with("com.fak.editor"));
    }

    #[test]
    fn 取不到平台目录时也always给得出一个路径() {
        assert!(app_config_dir_or_temp("com.fak.editor").is_absolute());
    }
}
