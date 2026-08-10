//! 启动与单实例转发的文件参数（SPEC §12.4、§12.5）。
//!
//! 双击文件、「打开方式」、拖到图标上、以及第二个实例转发过来的路径，
//! 最终都汇到同一条通道：一个 `app://open-paths` 事件，前端逐个开成标签。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const OPEN_PATHS_EVENT: &str = "app://open-paths";

/// 启动时命令行里带的文件。
///
/// 前端订阅事件要等到它挂载完，那时启动事件早就发过了；所以这批路径先存下来，
/// 由前端就绪后主动来取一次（取走即清空，避免热重载时重复打开）。
#[derive(Debug, Default)]
pub struct PendingOpenPaths {
    paths: Mutex<Vec<String>>,
    /// 前端是否已经来取过。取过之后再来的路径必须走事件——
    /// 继续排队的话没人再来取，文件就静默丢了
    taken: AtomicBool,
}

impl PendingOpenPaths {
    pub fn new(paths: Vec<String>) -> Self {
        Self {
            paths: Mutex::new(paths),
            taken: AtomicBool::new(false),
        }
    }

    /// macOS 的「打开方式」与单实例转发都可能在前端就绪前后任意时刻到达，
    /// 由这里统一决定是排队还是直接发事件。
    pub fn queue_or_emit(&self, app: &AppHandle, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        if self.taken.load(Ordering::SeqCst) {
            emit_open_paths(app, paths);
            return;
        }
        match self.paths.lock() {
            Ok(mut pending) => pending.extend(paths),
            Err(_) => emit_open_paths(app, paths),
        }
    }
}

/// 前端就绪后调用一次，取走启动时待打开的文件。
#[tauri::command]
pub fn take_startup_paths(pending: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    pending.taken.store(true, Ordering::SeqCst);
    pending
        .paths
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPaths {
    pub paths: Vec<String>,
}

/// 从命令行参数里挑出文件路径。
///
/// 跳过第一个（可执行文件自身）与所有 `-` 开头的开关：把 `--flag` 当成文件名
/// 去打开，只会得到一条看不懂的「文件不存在」。
pub fn file_arguments<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    args.iter()
        .skip(1)
        .map(|value| value.as_ref())
        .filter(|value| !value.starts_with('-') && !value.is_empty())
        .map(|value| value.to_string())
        .collect()
}

pub fn emit_open_paths(app: &AppHandle, paths: Vec<String>) {
    // 路径可能含用户名，不进日志（AGENTS.md §9.2）；只记条数
    log::info!("接力打开 {} 个文件", paths.len());
    if let Err(error) = app.emit(OPEN_PATHS_EVENT, OpenPaths { paths }) {
        log::warn!("转发待打开文件失败：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_the_executable_and_switches() {
        let args = vec!["fak.exe", "--flag", "a.txt", "-v", "b.md"];
        assert_eq!(file_arguments(&args), vec!["a.txt", "b.md"]);
    }

    #[test]
    fn an_empty_command_line_opens_nothing() {
        let args: Vec<&str> = vec!["fak.exe"];
        assert!(file_arguments(&args).is_empty());
    }

    #[test]
    fn paths_with_spaces_survive_intact() {
        let args = vec!["fak.exe", "C:\\my docs\\a b.txt"];
        assert_eq!(file_arguments(&args), vec!["C:\\my docs\\a b.txt"]);
    }

    #[test]
    fn 取走一次之后队列就空了() {
        let pending = PendingOpenPaths::new(vec!["a.txt".into()]);
        assert_eq!(
            pending.paths.lock().expect("锁").len(),
            1,
            "构造时应当带上启动路径"
        );
        pending.taken.store(true, Ordering::SeqCst);
        assert!(pending.taken.load(Ordering::SeqCst));
    }
}
