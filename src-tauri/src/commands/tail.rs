//! Tier C 日志跟随（SPEC F16）。
//!
//! 以 `notify` 的文件事件驱动，刷新走增量扫描（只看新增字节）。
//!
//! 仍保留一个**慢速兑底轮询**：Windows 上被 logrotate 替换的文件句柄不会可靠地
//! 产生同一种 notify 事件，只听事件会在轮转后永远停更新。

use crate::error::{AppError, AppResult};
use crate::stream::{StreamDocuments, StreamRefresh};
use dashmap::DashMap;
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

pub const TAIL_APPENDED_EVENT: &str = "app://document-tail-appended";

/// 事件漏掉时的兑底间隔。比原来的 150 ms 宽松得多——常规追加靠事件就够了，
/// 这个只用来兼 logrotate。
const FALLBACK_POLL: Duration = Duration::from_secs(1);

#[derive(Default)]
pub struct TailState {
    running: Mutex<DashMap<String, CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowArgs {
    pub document_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailAppended {
    pub document_id: String,
    pub line_count: usize,
    pub truncated: bool,
}

#[tauri::command]
pub fn start_follow(
    args: FollowArgs,
    app: tauri::AppHandle,
    tails: tauri::State<'_, Arc<TailState>>,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
) -> AppResult<()> {
    if !streams.contains(&args.document_id) {
        return Err(AppError::DocumentNotFound {
            document_id: args.document_id,
        });
    }
    let token = tails.start(&args.document_id)?;
    let document_id = args.document_id;
    let stream_state = streams.inner().clone();
    let path = stream_state.path(&document_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel();
        // 监听失败不能让跟随直接练断：掉回纯轮询仍然能用，只是延迟高一点
        let watcher = match notify::recommended_watcher(tx) {
            Ok(mut watcher) => match watcher.watch(&path, RecursiveMode::NonRecursive) {
                Ok(()) => Some(watcher),
                Err(_) => None,
            },
            Err(_) => None,
        };

        while !token.is_cancelled() {
            match rx.recv_timeout(FALLBACK_POLL) {
                Ok(_) => {
                    // 一次追加常常清出多个事件，排空后只刷一次
                    while rx.try_recv().is_ok() {}
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if token.is_cancelled() {
                break;
            }
            match stream_state.refresh(&document_id) {
                Ok(Some(refresh)) => emit(&app, &document_id, refresh),
                Ok(None) => {}
                Err(_) => break,
            }
        }
        drop(watcher);
    });
    Ok(())
}

#[tauri::command]
pub fn stop_follow(args: FollowArgs, tails: tauri::State<'_, Arc<TailState>>) {
    tails.stop(&args.document_id);
}

fn emit(app: &tauri::AppHandle, document_id: &str, refresh: StreamRefresh) {
    let _ = app.emit(
        TAIL_APPENDED_EVENT,
        TailAppended {
            document_id: document_id.to_string(),
            line_count: refresh.line_count,
            truncated: refresh.truncated,
        },
    );
}

impl TailState {
    fn start(&self, document_id: &str) -> AppResult<CancellationToken> {
        let token = CancellationToken::new();
        let running = self
            .running
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?;
        if let Some(previous) = running.insert(document_id.to_string(), token.clone()) {
            previous.cancel();
        }
        Ok(token)
    }

    fn stop(&self, document_id: &str) {
        if let Ok(running) = self.running.lock() {
            if let Some((_, token)) = running.remove(document_id) {
                token.cancel();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starting_again_cancels_previous_follower() {
        let state = TailState::default();
        let first = state.start("doc").expect("first");
        let _second = state.start("doc").expect("second");
        assert!(first.is_cancelled());
    }
}
