//! 会话的读写（SPEC F1.7 / P2-07）。
//!
//! 会话与配置分开存两个文件，理由有三条：
//!
//! 1. 会话是**每次退出都变**的高频数据，配置是低频的用户意图。混在一起
//!    会让配置文件的 mtime 天天在跳，用户想 diff 自己改了什么设置就没法看了。
//! 2. 会话里有**完整路径**（SPEC §10.2 说的是「不进 IPC 负载与日志」，
//!    落盘到本机配置目录是允许的，恢复功能没有它就不成立）。把它与用户
//!    可能贴到 issue 里的 `config.json` 分开，误泄漏的概率小得多。
//! 3. 会话坏了应该静默丢弃，配置坏了要隔离并提示——两种失败策略。
//!
//! 会话文件本身可以随时丢弃：它记的全是「上次的样子」，重建的代价是
//! 用户重新打开几个文件，而不是丢数据。所以这里所有的错误都不上报。

use crate::error::AppResult;
use crate::file_io::{save_atomic, ConflictPolicy};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SESSION_FILE: &str = "session.json";

/// 一次会话里打开过的一个文件。
///
/// 未命名文档**不进会话**：它的正文只在崩溃备份里（F1.6），
/// 在这里再记一条会让同一份内容有两个恢复来源，两者还可能不一致。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    pub path: PathBuf,
    /// 0 基行号。列不记：跨会话的列号在换了字体或改了 Tab 宽度之后意义不大，
    /// 而行号足够把用户送回他离开的地方
    #[serde(default)]
    pub line: usize,
    /// 编辑器滚动到的首个可见行。与光标分开记，因为用户常把光标留在
    /// 一处、把视口滚到另一处去对照
    #[serde(default)]
    pub top_line: usize,
    /// 书签的 0 基行号（SPEC F7「随 session.json 持久化」）。
    ///
    /// 记行号而不是 char 偏移：会话跨进程、跨文件版本，文件被外部编辑过之后
    /// 偏移毫无意义，而行号至少还落在一个人能理解的位置上。恢复时越界的行丢弃
    #[serde(default)]
    pub bookmarks: Vec<usize>,
    #[serde(default)]
    pub folded_lines: Vec<usize>,
    #[serde(default)]
    pub locked: bool,
}

/// 与文档标签无关、但属于「上次工作台长什么样」的状态（SPEC F1.7）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionViewState {
    pub workspace_root: Option<PathBuf>,
    #[serde(default)]
    pub expanded_paths: Vec<PathBuf>,
    #[serde(default)]
    pub file_tree_open: bool,
    #[serde(default)]
    pub bookmark_panel_open: bool,
    #[serde(default)]
    pub outline_panel_open: bool,
    #[serde(default)]
    pub markdown_preview_mode: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub entries: Vec<SessionEntry>,
    /// 上次处于前台的那个文件在 `entries` 里的下标
    #[serde(default)]
    pub active: Option<usize>,
    #[serde(default)]
    pub view: SessionViewState,
}

impl Session {
    /// 越界的 `active` 归零而不是报错：会话文件是可以被手工编辑的，
    /// 一个写歪的下标不该让整份会话作废
    fn sanitize(mut self) -> Self {
        if self.entries.is_empty() {
            self.active = None;
        } else if self.active.is_some_and(|index| index >= self.entries.len()) {
            self.active = Some(0);
        }
        self
    }
}

pub fn path_in(config_dir: &Path) -> PathBuf {
    config_dir.join(SESSION_FILE)
}

/// 读会话。缺失、空、读不懂一律回空会话——**不阻塞启动**（SPEC §8.1：冷启动 < 800 ms）。
pub fn read(path: &Path) -> Session {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Session::default();
    };
    serde_json::from_str::<Session>(&text)
        .unwrap_or_default()
        .sanitize()
}

/// 写会话。走与保存文档同一条原子写路径：写到一半断电只会留下
/// 旧会话或新会话之一，不会留下半截 JSON 让下次启动读出个空会话。
pub fn write(path: &Path, session: &Session) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut bytes = serde_json::to_vec_pretty(session).unwrap_or_else(|_| b"{}".to_vec());
    bytes.push(b'\n');
    save_atomic(path, &bytes, None, ConflictPolicy::Overwrite)?;
    Ok(())
}

/// 过滤掉已经不存在的文件，并把 `active` 跟着搬到新的下标上。
///
/// 文件被删或被移走是**常态**而不是异常：会话可能是几天前存的。
/// 所以这里静默跳过，由调用方在状态栏说一句「N 个文件已不存在」，
/// 不弹对话框拦住启动（SPEC F1.7 步骤 2）。
pub fn drop_missing(session: Session, exists: impl Fn(&Path) -> bool) -> (Session, usize) {
    let active_path = session
        .active
        .and_then(|index| session.entries.get(index))
        .map(|entry| entry.path.clone());
    let view = session.view.clone();

    let before = session.entries.len();
    let entries: Vec<SessionEntry> = session
        .entries
        .into_iter()
        .filter(|entry| exists(&entry.path))
        .collect();
    let missing = before - entries.len();

    // 原来的活动文件自己也可能已经没了，那就退回第一个
    let active = match active_path {
        Some(path) => entries
            .iter()
            .position(|entry| entry.path == path)
            .or(if entries.is_empty() { None } else { Some(0) }),
        None if entries.is_empty() => None,
        None => Some(0),
    };

    (
        Session {
            entries,
            active,
            view,
        }
        .sanitize(),
        missing,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str) -> SessionEntry {
        SessionEntry {
            path: PathBuf::from(path),
            line: 0,
            top_line: 0,
            bookmarks: Vec::new(),
            folded_lines: Vec::new(),
            locked: false,
        }
    }

    #[test]
    fn a_missing_file_yields_an_empty_session() {
        let dir = tempfile::tempdir().expect("临时目录");
        assert_eq!(read(&path_in(dir.path())), Session::default());
    }

    #[test]
    fn an_unparsable_session_is_silently_discarded() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = path_in(dir.path());
        std::fs::write(&path, b"{ not json").expect("写测试文件");
        assert_eq!(read(&path), Session::default());
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = path_in(dir.path());
        let session = Session {
            entries: vec![
                SessionEntry {
                    path: PathBuf::from("/a.txt"),
                    line: 42,
                    top_line: 30,
                    bookmarks: vec![3, 17],
                    folded_lines: vec![5, 11],
                    locked: true,
                },
                entry("/b.txt"),
            ],
            active: Some(1),
            view: SessionViewState {
                workspace_root: Some(PathBuf::from("/workspace")),
                file_tree_open: true,
                ..SessionViewState::default()
            },
        };
        write(&path, &session).expect("写会话");
        assert_eq!(read(&path), session);
    }

    // 会话文件是可以被手工编辑的，一个写歪的下标不该让整份会话作废
    #[test]
    fn an_out_of_range_active_index_falls_back_to_the_first_entry() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = path_in(dir.path());
        std::fs::write(&path, br#"{"entries":[{"path":"/a.txt"}],"active":7}"#)
            .expect("写测试文件");
        assert_eq!(read(&path).active, Some(0));
    }

    #[test]
    fn an_empty_session_has_no_active_entry() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = path_in(dir.path());
        std::fs::write(&path, br#"{"entries":[],"active":3}"#).expect("写测试文件");
        assert_eq!(read(&path).active, None);
    }

    // 缺字段用默认值：老版本写的会话不该让新版本读不出来
    #[test]
    fn missing_optional_fields_fall_back_to_zero() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = path_in(dir.path());
        std::fs::write(&path, br#"{"entries":[{"path":"/a.txt"}]}"#).expect("写测试文件");
        let session = read(&path);
        assert_eq!(session.entries[0].line, 0);
        assert_eq!(session.entries[0].top_line, 0);
        assert!(session.entries[0].bookmarks.is_empty());
    }

    #[test]
    fn drop_missing_removes_files_that_are_gone() {
        let session = Session {
            entries: vec![entry("/a.txt"), entry("/gone.txt"), entry("/c.txt")],
            active: Some(2),
            ..Session::default()
        };
        let (kept, missing) = drop_missing(session, |path| path != Path::new("/gone.txt"));
        assert_eq!(missing, 1);
        assert_eq!(kept.entries.len(), 2);
        // 活动文件还在，下标要跟着前移
        assert_eq!(kept.active, Some(1));
    }

    #[test]
    fn losing_the_active_file_falls_back_to_the_first_survivor() {
        let session = Session {
            entries: vec![entry("/a.txt"), entry("/gone.txt")],
            active: Some(1),
            ..Session::default()
        };
        let (kept, missing) = drop_missing(session, |path| path != Path::new("/gone.txt"));
        assert_eq!(missing, 1);
        assert_eq!(kept.active, Some(0));
    }

    #[test]
    fn losing_everything_leaves_nothing_active() {
        let session = Session {
            entries: vec![entry("/gone.txt")],
            active: Some(0),
            ..Session::default()
        };
        let (kept, missing) = drop_missing(session, |_| false);
        assert_eq!(missing, 1);
        assert!(kept.entries.is_empty());
        assert_eq!(kept.active, None);
    }

    #[test]
    fn nothing_missing_keeps_the_session_intact() {
        let session = Session {
            entries: vec![entry("/a.txt"), entry("/b.txt")],
            active: Some(1),
            ..Session::default()
        };
        let (kept, missing) = drop_missing(session.clone(), |_| true);
        assert_eq!(missing, 0);
        assert_eq!(kept, session);
    }
}
