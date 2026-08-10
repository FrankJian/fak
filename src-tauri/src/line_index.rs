//! Tier C 稀疏行索引（SPEC ADR-02、P1-04）。
//!
//! 文件只读映射，正文不进前端；索引只存每 64 行一个锚点，读取视口时在块内扫描。

use crate::error::{path_hint, AppError, AppResult};
use memmap2::Mmap;
use serde::Serialize;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// 稀疏索引步长：每 N 行存一个偏移，块内现扫。
///
/// 1 GB / 平均 80 B 每行 ≈ 1300 万行，稠密索引就是 104 MB；步长 64 把它压到约 1.6 MB。
const SPARSE_STRIDE: usize = 64;

#[derive(Debug)]
pub struct LineIndex {
    path: PathBuf,
    mmap: Mmap,
    /// 每 SPARSE_STRIDE 行的起始字节偏移。
    anchors: Vec<u64>,
    line_count: usize,
    max_line_len: usize,
    byte_len: u64,
    /// 换行符个数与最后一行起点。追加时从这里接着扫，不必重扫全文。
    newlines: usize,
    last_line_start: usize,
}

/// 扫描到某一点的累计状态。抽出来是为了让「从头扫」与「接着扫」共用同一段逻辑——
/// 两份实现分别演进的话，增量路径的错行会非常难查。
#[derive(Debug, Clone)]
struct Scan {
    anchors: Vec<u64>,
    newlines: usize,
    max_line_len: usize,
    last_line_start: usize,
}

impl Scan {
    fn fresh() -> Self {
        Self {
            anchors: vec![0],
            newlines: 0,
            max_line_len: 0,
            last_line_start: 0,
        }
    }
}

/// 从 `state.last_line_start` 继续扫描。
///
/// 成立的前提是**追加不会改变已有行的起始偏移**，所以旧锚点全部继续有效。
/// `last_line_start` 永远紧跟在最后一个换行符之后，因此重扫区间里不含旧换行符，
/// 不会重复计数。
fn scan_from(bytes: &[u8], mut state: Scan) -> Scan {
    let mut cursor = state.last_line_start;
    let mut line_start = state.last_line_start;
    while cursor < bytes.len() {
        let Some(offset) = memchr::memchr(b'\n', &bytes[cursor..]) else {
            break;
        };
        let absolute = cursor + offset + 1;
        let mut line_end = absolute - 1;
        if line_end > line_start && bytes.get(line_end - 1) == Some(&b'\r') {
            line_end -= 1;
        }
        state.max_line_len = state.max_line_len.max(line_end - line_start);
        state.newlines += 1;
        if state.newlines.is_multiple_of(SPARSE_STRIDE) {
            state.anchors.push(absolute as u64);
        }
        cursor = absolute;
        line_start = absolute;
    }
    if line_start < bytes.len() {
        state.max_line_len = state.max_line_len.max(bytes.len() - line_start);
    }
    state.last_line_start = line_start;
    state
}

/// 空文件算一行；结尾有换行时不额外多算一行。
fn line_count_of(bytes: &[u8], newlines: usize) -> usize {
    if bytes.is_empty() {
        1
    } else if bytes[bytes.len() - 1] == b'\n' {
        newlines
    } else {
        newlines + 1
    }
}

fn map_file(path: &Path) -> AppResult<Mmap> {
    let file = File::open(path).map_err(|error| AppError::from_io(&error, path))?;
    // SAFETY: 只读映射。外部截断由 `extend` 检出后走全量重建，不会读到陈旧映射。
    unsafe { Mmap::map(&file) }.map_err(|error| AppError::from_io(&error, path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub line_count: usize,
    pub byte_len: u64,
    pub anchor_count: usize,
    pub index_bytes: usize,
    pub build_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineWindow {
    pub start_line: usize,
    pub lines: Vec<String>,
    pub read_ms: f64,
}

impl LineIndex {
    pub fn open(path: impl AsRef<Path>) -> AppResult<Self> {
        let path = path.as_ref();
        let started = Instant::now();
        let mmap = map_file(path)?;
        let scan = scan_from(&mmap, Scan::fresh());

        log::info!(
            "line index built: {} lines, {} anchors, {:.0} ms",
            line_count_of(&mmap, scan.newlines),
            scan.anchors.len(),
            started.elapsed().as_secs_f64() * 1000.0
        );

        Ok(Self::assemble(path.to_path_buf(), mmap, scan))
    }

    /// 文件被追加后只扫新增字节（SPEC F16 / P4-04）。
    ///
    /// 文件缩短说明发生了 logrotate 或截断，已有偏移全部作废，返回 `None`
    /// 让调用方走全量重建——那种情况下增量是不安全的。
    pub fn extend(&self) -> AppResult<Option<Self>> {
        let mmap = map_file(&self.path)?;
        if (mmap.len() as u64) < self.byte_len {
            return Ok(None);
        }
        let scan = scan_from(
            &mmap,
            Scan {
                anchors: self.anchors.clone(),
                newlines: self.newlines,
                max_line_len: self.max_line_len,
                last_line_start: self.last_line_start,
            },
        );
        Ok(Some(Self::assemble(self.path.clone(), mmap, scan)))
    }

    fn assemble(path: PathBuf, mmap: Mmap, scan: Scan) -> Self {
        Self {
            byte_len: mmap.len() as u64,
            line_count: line_count_of(&mmap, scan.newlines),
            path,
            mmap,
            anchors: scan.anchors,
            max_line_len: scan.max_line_len,
            newlines: scan.newlines,
            last_line_start: scan.last_line_start,
        }
    }

    pub fn stats(&self, build_ms: f64) -> IndexStats {
        IndexStats {
            line_count: self.line_count,
            byte_len: self.byte_len,
            anchor_count: self.anchors.len(),
            index_bytes: self.anchors.len() * std::mem::size_of::<u64>(),
            build_ms,
        }
    }

    pub fn line_count(&self) -> usize {
        self.line_count
    }

    /// 字节长度的最大行宽。档位判定宁可保守上调，不把宽字符当作窄行。
    pub fn max_line_len(&self) -> usize {
        self.max_line_len
    }

    pub fn path_hint(&self) -> String {
        path_hint(&self.path)
    }

    /// 行首字节偏移：从最近的锚点开始向前扫，最多扫 SPARSE_STRIDE 行。
    fn line_start(&self, line: usize) -> Option<usize> {
        if line >= self.line_count {
            return None;
        }
        let anchor_index = line / SPARSE_STRIDE;
        let mut offset = *self.anchors.get(anchor_index)? as usize;
        let mut current = anchor_index * SPARSE_STRIDE;
        while current < line {
            let found = memchr::memchr(b'\n', &self.mmap[offset..])?;
            offset += found + 1;
            current += 1;
        }
        Some(offset)
    }

    /// 取 [start, start + count) 行。Tier C 下这是前端唯一的取文本通道。
    pub fn read_lines(&self, start: usize, count: usize) -> LineWindow {
        let started = Instant::now();
        let mut lines = Vec::with_capacity(count);
        let Some(mut offset) = self.line_start(start) else {
            return LineWindow {
                start_line: start,
                lines,
                read_ms: 0.0,
            };
        };

        for _ in 0..count {
            if offset >= self.mmap.len() {
                break;
            }
            let end = match memchr::memchr(b'\n', &self.mmap[offset..]) {
                Some(found) => offset + found,
                None => self.mmap.len(),
            };
            let raw = &self.mmap[offset..end];
            let trimmed = raw.strip_suffix(b"\r").unwrap_or(raw);
            let capped = &trimmed[..trimmed.len().min(crate::constants::LINE_PREVIEW_MAX_BYTES)];
            lines.push(String::from_utf8_lossy(capped).into_owned());
            offset = end + 1;
        }

        LineWindow {
            start_line: start,
            lines,
            read_ms: started.elapsed().as_secs_f64() * 1000.0,
        }
    }

    /// 从 `from` 行起逐行回调，**不做预览截断**。
    ///
    /// 查找必须走这条路而不是 `read_lines`：Tier C 常常正是因为超长行才降到这一档，
    /// 拿截断过的预览去匹配，长行后半段里的命中会被静默漏掉。
    ///
    /// 回调返回 `false` 即停止扫描（用于取消）。
    pub fn for_each_line<F>(&self, from: usize, mut visit: F)
    where
        F: FnMut(usize, &str) -> bool,
    {
        let Some(mut offset) = self.line_start(from) else {
            return;
        };
        let mut line = from;
        while offset < self.mmap.len() {
            let end = match memchr::memchr(b'\n', &self.mmap[offset..]) {
                Some(found) => offset + found,
                None => self.mmap.len(),
            };
            let raw = &self.mmap[offset..end];
            let trimmed = raw.strip_suffix(b"\r").unwrap_or(raw);
            if !visit(line, &String::from_utf8_lossy(trimmed)) {
                return;
            }
            line += 1;
            offset = end + 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(content: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().expect("临时文件");
        file.write_all(content).expect("写入");
        file.flush().expect("flush");
        file
    }

    #[test]
    fn counts_lines_without_trailing_newline() {
        let file = write_temp(b"a\nbb\nccc");
        let index = LineIndex::open(file.path()).expect("建索引");
        assert_eq!(index.line_count(), 3);
        assert_eq!(index.read_lines(0, 10).lines, vec!["a", "bb", "ccc"]);
    }

    #[test]
    fn trailing_newline_does_not_add_phantom_line() {
        let file = write_temp(b"a\nbb\n");
        let index = LineIndex::open(file.path()).expect("建索引");
        assert_eq!(index.line_count(), 2);
    }

    #[test]
    fn reads_window_across_sparse_anchors() {
        let content: String = (0..500).map(|index| format!("line-{index}\n")).collect();
        let file = write_temp(content.as_bytes());
        let index = LineIndex::open(file.path()).expect("建索引");
        assert_eq!(index.line_count(), 500);

        let window = index.read_lines(321, 3);
        assert_eq!(window.lines, vec!["line-321", "line-322", "line-323"]);
    }

    #[test]
    fn strips_crlf_and_reads_past_end_safely() {
        let file = write_temp(b"a\r\nb\r\n");
        let index = LineIndex::open(file.path()).expect("建索引");
        assert_eq!(index.read_lines(0, 5).lines, vec!["a", "b"]);
        assert!(index.read_lines(99, 5).lines.is_empty());
    }

    #[test]
    fn missing_file_reports_structured_error() {
        let error = LineIndex::open("no-such-file-here.log").expect_err("应当报错");
        assert!(matches!(error, AppError::FileNotFound { .. }));
    }

    #[test]
    fn 扫描不截断超长行否则查找会漏掉后半段() {
        let cap = crate::constants::LINE_PREVIEW_MAX_BYTES;
        let long = format!("{}NEEDLE\n", "x".repeat(cap * 2));
        let file = write_temp(long.as_bytes());
        let index = LineIndex::open(file.path()).expect("建索引");

        // read_lines 走的是预览路径，会砍掉 NEEDLE
        assert!(!index.read_lines(0, 1).lines[0].contains("NEEDLE"));

        let mut seen = false;
        index.for_each_line(0, |_, line| {
            if line.contains("NEEDLE") {
                seen = true;
            }
            true
        });
        assert!(seen, "扫描必须看到超长行的全部内容");
    }

    #[test]
    fn 扫描能从中间某行起步() {
        let content: String = (0..200).map(|i| format!("line-{i}\n")).collect();
        let file = write_temp(content.as_bytes());
        let index = LineIndex::open(file.path()).expect("建索引");

        let mut first = None;
        index.for_each_line(150, |line_number, line| {
            first = Some((line_number, line.to_string()));
            false
        });
        assert_eq!(first, Some((150, "line-150".to_string())));
    }

    #[test]
    fn 回调返回_false_立刻停止扫描() {
        let content: String = (0..100).map(|i| format!("line-{i}\n")).collect();
        let file = write_temp(content.as_bytes());
        let index = LineIndex::open(file.path()).expect("建索引");

        let mut visited = 0usize;
        index.for_each_line(0, |_, _| {
            visited += 1;
            visited < 3
        });
        assert_eq!(visited, 3, "取消后不该继续扫下去");
    }

    /// 增量扫描的正确性只能靠「与全量重建对比」来保证：
    /// 错行、少算一行这类 bug 在人工测试里基本抓不到。
    fn assert_matches_full_rebuild(chunks: &[&[u8]]) {
        let mut file = tempfile::NamedTempFile::new().expect("临时文件");
        let mut content = Vec::new();

        file.write_all(chunks[0]).expect("写入");
        file.flush().expect("flush");
        content.extend_from_slice(chunks[0]);
        let mut index = LineIndex::open(file.path()).expect("建索引");

        for chunk in &chunks[1..] {
            file.write_all(chunk).expect("追加");
            file.flush().expect("flush");
            content.extend_from_slice(chunk);

            index = index.extend().expect("增量").expect("追加不该判成截断");
            let full = LineIndex::open(file.path()).expect("全量");

            assert_eq!(index.line_count(), full.line_count(), "行数不一致");
            assert_eq!(index.max_line_len(), full.max_line_len(), "最大行宽不一致");
            assert_eq!(index.anchors, full.anchors, "锚点不一致");
            assert_eq!(
                index.read_lines(0, usize::from(u16::MAX)).lines,
                full.read_lines(0, usize::from(u16::MAX)).lines,
                "正文不一致"
            );
        }
    }

    #[test]
    fn incremental_matches_full_rebuild_for_whole_lines() {
        assert_matches_full_rebuild(&[b"a\n", b"bb\n", b"ccc\n"]);
    }

    #[test]
    fn incremental_matches_full_rebuild_when_last_line_was_partial() {
        // 上一轮结尾没有换行，这一轮把它补完 —— 最容易错行的一种情况
        assert_matches_full_rebuild(&[b"a\nbb", b"bb-continued\n", b"ccc"]);
    }

    #[test]
    fn incremental_matches_full_rebuild_across_anchor_stride() {
        let first: String = (0..100).map(|i| format!("line-{i}\n")).collect();
        let second: String = (100..260).map(|i| format!("line-{i}\n")).collect();
        assert_matches_full_rebuild(&[first.as_bytes(), second.as_bytes()]);
    }

    #[test]
    fn incremental_matches_full_rebuild_with_crlf() {
        assert_matches_full_rebuild(&[b"a\r\n", b"bb\r\n", b"ccc\r\n"]);
    }

    #[test]
    fn incremental_from_empty_file() {
        assert_matches_full_rebuild(&[b"", b"first\n", b"second\n"]);
    }

    /// Windows 不允许截断正被 mmap 的文件（OS error 1224），这个场景在本进程内
    /// 模拟不出来，只能在 unix 上验。
    #[cfg(unix)]
    #[test]
    fn truncation_is_reported_so_caller_rebuilds() {
        let file = write_temp(b"a\nbb\nccc\n");
        let index = LineIndex::open(file.path()).expect("建索引");

        std::fs::write(file.path(), b"x\n").expect("截断");
        assert!(
            index.extend().expect("增量").is_none(),
            "文件变短必须报告出来，增量偏移已经作废"
        );
    }
}
