//! `config.json` 的外部变更监听（SPEC 9.3 第 7 条）。
//!
//! 监听的是**目录**而不是文件本身：原子写是「写临时文件 + rename」，
//! 被替换掉的那个 inode 上的 watch 会跟着旧文件走，之后再也收不到事件。
//!
//! 回环抑制不在这里做，在 `ConfigStore::reload_if_external` 里——判据是
//! 「距上次自写多久」与「内容是否真的变了」，跟事件来源无关。

use crate::commands::config::{ConfigReloaded, ConfigStore, CONFIG_RELOADED_EVENT};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{Emitter, Manager};

/// 去抖窗口。编辑器保存配置文件时会连着发好几个事件，
/// 每个都重载一次的话，用户在自家配置文件上按 Ctrl+S 会看到界面连闪几下。
const DEBOUNCE: Duration = Duration::from_millis(250);

/// 监听器活着才有事件。返回值必须被持有（通常交给 `app.manage`），
/// 丢掉它等于静默关掉热重载。
pub type ConfigWatcher =
    Debouncer<notify::RecommendedWatcher, notify_debouncer_full::RecommendedCache>;

/// 启动监听。失败不是致命错误：热重载只是便利功能，
/// 拿不到 watcher 时应用照常可用，只是改配置要重启才生效。
pub fn spawn(app: tauri::AppHandle, directory: &Path) -> Option<ConfigWatcher> {
    let (tx, rx) = mpsc::channel::<Result<Vec<DebouncedEvent>, Vec<notify::Error>>>();

    let mut debouncer = match new_debouncer(DEBOUNCE, None, tx) {
        Ok(debouncer) => debouncer,
        Err(error) => {
            // 只记错误种类：notify::Error 的 Display 会带上被监听的完整路径（AGENTS.md §9.2）
            log::warn!("配置热重载不可用：{:?}", error.kind);
            return None;
        }
    };

    if let Err(error) = debouncer.watch(directory, RecursiveMode::NonRecursive) {
        log::warn!("配置目录无法监听，热重载已关闭：{:?}", error.kind);
        return None;
    }

    std::thread::spawn(move || {
        for batch in rx {
            // 出错的批次直接跳过：监听失效时重载没有意义，
            // 而下一次真正的写入会重新带来一个正常批次
            if batch.is_err() {
                continue;
            }
            let Some(store) = app.try_state::<ConfigStore>() else {
                continue;
            };
            match store.reload_if_external() {
                Ok(Some(reloaded)) => emit(&app, reloaded),
                Ok(None) => {}
                Err(_) => log::warn!("配置热重载失败，沿用当前配置"),
            }
        }
    });

    Some(debouncer)
}

fn emit(app: &tauri::AppHandle, reloaded: ConfigReloaded) {
    if app.emit(CONFIG_RELOADED_EVENT, reloaded).is_err() {
        log::warn!("配置热重载事件发送失败");
    }
}
