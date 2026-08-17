//! 启动与单实例转发的文件参数（SPEC §12.4、§12.5）。
//!
//! 双击文件、「打开方式」、拖到图标上、以及第二个实例转发过来的路径，
//! 最终都进入同一队列；`app://open-paths` 只提醒前端排空队列。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const OPEN_PATHS_EVENT: &str = "app://open-paths";

/// 系统交给应用、尚未被前端打开的文件。
///
/// 路径始终先入队再发通知，因此冷启动、React 严格模式重挂载和事件订阅间隙
/// 都不会丢数据；前端每次收到通知后主动排空。
#[derive(Debug, Default)]
pub struct PendingOpenPaths {
    paths: Mutex<Vec<String>>,
    /// 前端是否至少完成过一次主动读取。之后的新路径仍然入队，
    /// 事件只负责提醒前端再来排空，不能把路径本身当成唯一副本。
    frontend_ready: AtomicBool,
}

impl PendingOpenPaths {
    pub fn new(paths: Vec<String>) -> Self {
        Self {
            paths: Mutex::new(paths),
            frontend_ready: AtomicBool::new(false),
        }
    }

    /// macOS 的「打开方式」与单实例转发都可能在前端就绪前后任意时刻到达，
    /// 由这里统一入队；前端已就绪时再额外发出排空通知。
    pub fn queue_or_emit(&self, app: &AppHandle, paths: Vec<String>) {
        if paths.is_empty() {
            return;
        }
        // 无论前端是否就绪都先入队。事件可能撞上 React 的订阅重建窗口，
        // 只发事件不保留副本仍会把系统打开请求永久丢掉。
        if self.enqueue(&paths) {
            emit_open_paths(app, paths);
        }
    }

    fn enqueue(&self, paths: &[String]) -> bool {
        let mut pending = match self.paths.lock() {
            Ok(pending) => pending,
            // 路径队列只有 append/take，没有需要回滚的不变量；中毒后保留数据
            // 比把一次系统打开请求静默丢掉更安全。
            Err(poisoned) => poisoned.into_inner(),
        };
        pending.extend(paths.iter().cloned());
        self.frontend_ready.load(Ordering::SeqCst)
    }

    fn drain(&self) -> Vec<String> {
        // 先标记再拿锁：并发入队要么发生在此之前并被本次排空，要么看到 ready
        // 后发出事件；不会出现“刚排空、尚未 ready”而永久滞留的窗口。
        self.frontend_ready.store(true, Ordering::SeqCst);
        let mut pending = match self.paths.lock() {
            Ok(pending) => pending,
            Err(poisoned) => poisoned.into_inner(),
        };
        std::mem::take(&mut *pending)
    }
}

/// 排空当前待打开路径。可重复调用；事件到达时前端也通过它取数据。
#[tauri::command]
pub fn take_startup_paths(pending: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    pending.drain()
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
    fn 排空后仍可接收下一批路径() {
        let pending = PendingOpenPaths::new(vec!["a.txt".into()]);
        assert_eq!(pending.drain(), vec!["a.txt"]);
        assert!(pending.enqueue(&["b.md".into()]));
        assert_eq!(pending.drain(), vec!["b.md"]);
        assert!(pending.drain().is_empty());
    }
}
