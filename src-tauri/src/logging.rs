//! panic 兜底（P1-01 步骤 3）。库代码不得主动 panic，这里是最后防线：
//! 记一条日志 + 弹一次对话框，绝不静默退出。

use std::panic::PanicHookInfo;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

/// 把已运行的窗口拉到前台。第二个实例把文件转发过来之后，
/// 窗口还在后台的话，用户会以为「双击没反应」（SPEC §12.5）。
pub fn focus_main_window(app: &AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// 连环 panic 时只弹一次，否则用户会被对话框刷屏。
static NOTIFIED: AtomicBool = AtomicBool::new(false);

/// 首次调用返回 true，之后恒为 false。
fn claim_notification_slot() -> bool {
    !NOTIFIED.swap(true, Ordering::SeqCst)
}

/// panic 位置（文件:行）不含用户数据，可安全入日志；
/// payload 可能夹带文档正文，只记类型不记内容（AGENTS.md §9.2）。
fn location_of(info: &PanicHookInfo<'_>) -> String {
    info.location()
        .map(|l| format!("{}:{}", l.file(), l.line()))
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn install_panic_hook(app: AppHandle) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = location_of(info);
        log::error!("panic at {location}");

        if claim_notification_slot() {
            // 非阻塞：panic 可能发生在主线程，阻塞式对话框会直接死锁
            app.dialog()
                .message(format!(
                    "Fak encountered an internal error at {location}.\n\
                     Your unsaved work is backed up. Please restart the app."
                ))
                .kind(MessageDialogKind::Error)
                .title("Fak")
                .show(|_| {});
        }

        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_first_panic_gets_a_dialog() {
        assert!(claim_notification_slot(), "首次 panic 必须弹窗");
        assert!(!claim_notification_slot(), "连环 panic 不得重复弹窗");
        assert!(!claim_notification_slot());
    }
}
