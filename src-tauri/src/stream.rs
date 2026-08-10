//! Tier C 文档的按需行访问注册表（SPEC §4.1、ADR-02）。
//!
//! 稀疏索引按需读取文件；这里把每份索引按 document id 管理，并在日志追加或
//! 轮转后用新索引替换旧快照。

use crate::encoding::EncodingLabel;
use crate::error::{AppError, AppResult};
use crate::line_index::{LineIndex, LineWindow};
use dashmap::DashMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Default)]
pub struct StreamDocuments {
    indexes: DashMap<String, StreamEntry>,
}

struct StreamEntry {
    path: std::path::PathBuf,
    index: Arc<LineIndex>,
}

#[derive(Debug, Clone, Copy)]
pub struct StreamInfo {
    pub line_count: usize,
    pub max_line_len: usize,
}

impl StreamDocuments {
    pub fn open(
        &self,
        document_id: String,
        path: &Path,
        encoding: EncodingLabel,
    ) -> AppResult<StreamInfo> {
        let index = LineIndex::open_with_encoding(path, encoding)?;
        let info = StreamInfo {
            line_count: index.line_count(),
            max_line_len: index.max_line_len(),
        };
        self.indexes.insert(
            document_id,
            StreamEntry {
                path: path.to_path_buf(),
                index: Arc::new(index),
            },
        );
        Ok(info)
    }

    pub fn read_lines(
        &self,
        document_id: &str,
        start: usize,
        count: usize,
    ) -> AppResult<LineWindow> {
        let index = self
            .indexes
            .get(document_id)
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: document_id.to_string(),
            })?;
        index.index.read_lines(start, count)
    }

    pub fn contains(&self, document_id: &str) -> bool {
        self.indexes.contains_key(document_id)
    }

    /// 拿到索引本体做整体扫描（查找用）。返回 `Arc` 而不是持锁遍历，
    /// 否则一次 1 GB 的扫描会把整个注册表锁住，跟随模式的刷新全被堵死。
    pub fn index(&self, document_id: &str) -> AppResult<Arc<LineIndex>> {
        self.indexes
            .get(document_id)
            .map(|entry| entry.index.clone())
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: document_id.to_string(),
            })
    }

    pub fn line_count(&self, document_id: &str) -> Option<usize> {
        self.indexes
            .get(document_id)
            .map(|entry| entry.index.line_count())
    }

    /// 档位提升时重新把磁盘文本装进 Rope；路径只在 Rust 侧流转，不回传前端。
    pub fn path(&self, document_id: &str) -> AppResult<std::path::PathBuf> {
        self.indexes
            .get(document_id)
            .map(|entry| entry.path.clone())
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: document_id.to_string(),
            })
    }

    /// 文件被追加或 logrotate 截断后刷新索引；运行在监听线程中，不阻塞 UI。
    ///
    /// 追加走增量扫描（只看新增字节），截断才全量重建——日志跟随场景下
    /// 每 150 ms 重扫 1 GB 是不可接受的。
    pub fn refresh(&self, document_id: &str) -> AppResult<Option<StreamRefresh>> {
        let entry = self
            .indexes
            .get(document_id)
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: document_id.to_string(),
            })?;
        let previous_size = entry.index.stats(0.0).byte_len;
        let encoding = entry.index.encoding();
        let path = entry.path.clone();
        let extended = entry.index.extend()?;
        drop(entry);

        let (index, truncated) = match extended {
            Some(index) if index.stats(0.0).byte_len == previous_size => return Ok(None),
            Some(index) => (index, false),
            None => (LineIndex::open_with_encoding(&path, encoding)?, true),
        };

        let refresh = StreamRefresh {
            line_count: index.line_count(),
            truncated,
        };
        self.indexes.insert(
            document_id.to_string(),
            StreamEntry {
                path,
                index: Arc::new(index),
            },
        );
        Ok(Some(refresh))
    }

    pub fn close(&self, document_id: &str) {
        self.indexes.remove(document_id);
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamRefresh {
    pub line_count: usize,
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn indexed_document_serves_windows_and_is_removed_on_close() {
        let mut file = tempfile::NamedTempFile::new().expect("temporary file");
        file.write_all(b"a\nb\nc\n").expect("content");
        file.flush().expect("flush");
        let streams = StreamDocuments::default();

        let info = streams
            .open("stream-1".into(), file.path(), EncodingLabel::Utf8)
            .expect("open index");
        assert_eq!(info.line_count, 3);
        assert_eq!(info.max_line_len, 1);
        assert!(streams.contains("stream-1"));
        assert_eq!(streams.line_count("stream-1"), Some(3));
        assert_eq!(streams.path("stream-1").expect("path"), file.path());
        assert_eq!(
            streams.read_lines("stream-1", 1, 2).expect("lines").lines,
            ["b", "c"]
        );

        streams.close("stream-1");
        assert!(!streams.contains("stream-1"));
    }
}
