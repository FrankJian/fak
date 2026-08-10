use super::*;
use crate::encoding::encode;
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
    assert_eq!(
        index.read_lines(0, 10).expect("读取").lines,
        ["a", "bb", "ccc"]
    );
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
    assert_eq!(
        index.read_lines(321, 3).expect("读取").lines,
        ["line-321", "line-322", "line-323"]
    );
}

#[test]
fn strips_crlf_and_reads_past_end_safely() {
    let file = write_temp(b"a\r\nb\r\n");
    let index = LineIndex::open(file.path()).expect("建索引");
    assert_eq!(index.read_lines(0, 5).expect("读取").lines, ["a", "b"]);
    assert!(index.read_lines(99, 5).expect("读取").lines.is_empty());
}

#[test]
fn utf16_newlines_are_found_only_on_code_unit_boundaries() {
    // “上”的 LE 低字节也是 0A，按单字节找换行会误判。
    let bytes = encode("上面\r\n第二行", EncodingLabel::Utf16Le).expect("编码");
    let file = write_temp(&bytes);
    let index = LineIndex::open_with_encoding(file.path(), EncodingLabel::Utf16Le).expect("建索引");
    assert_eq!(index.line_count(), 2);
    assert_eq!(
        index.read_lines(0, 2).expect("读取").lines,
        ["上面", "第二行"]
    );
}

#[test]
fn missing_file_reports_structured_error() {
    let error = LineIndex::open("no-such-file-here.log").expect_err("应当报错");
    assert!(matches!(error, AppError::FileNotFound { .. }));
}

#[test]
fn scan_keeps_full_long_line() {
    let cap = crate::constants::LINE_PREVIEW_MAX_BYTES;
    let long = format!("{}NEEDLE\n", "x".repeat(cap * 2));
    let file = write_temp(long.as_bytes());
    let index = LineIndex::open(file.path()).expect("建索引");
    assert!(!index.read_lines(0, 1).expect("读取").lines[0].contains("NEEDLE"));
    let mut seen = false;
    index
        .for_each_line(0, |_, line| {
            seen = line.contains("NEEDLE");
            true
        })
        .expect("扫描");
    assert!(seen);
}

#[test]
fn an_index_snapshot_does_not_read_later_appends() {
    let mut file = write_temp(b"first\n");
    let index = LineIndex::open(file.path()).expect("建索引");
    file.write_all(b"second\n").expect("追加");
    file.flush().expect("flush");

    let mut lines = Vec::new();
    index
        .for_each_line(0, |_, line| {
            lines.push(line.to_string());
            true
        })
        .expect("扫描快照");
    assert_eq!(lines, ["first"]);
}

fn assert_matches_full_rebuild(chunks: &[&[u8]]) {
    let mut file = tempfile::NamedTempFile::new().expect("临时文件");
    file.write_all(chunks[0]).expect("写入");
    file.flush().expect("flush");
    let mut index = LineIndex::open(file.path()).expect("建索引");
    for chunk in &chunks[1..] {
        file.write_all(chunk).expect("追加");
        file.flush().expect("flush");
        index = index.extend().expect("增量").expect("追加不该判成截断");
        let full = LineIndex::open(file.path()).expect("全量");
        assert_eq!(index.line_count(), full.line_count());
        assert_eq!(index.max_line_len(), full.max_line_len());
        assert_eq!(index.anchors, full.anchors);
        assert_eq!(
            index
                .read_lines(0, usize::from(u16::MAX))
                .expect("增量正文")
                .lines,
            full.read_lines(0, usize::from(u16::MAX))
                .expect("全量正文")
                .lines
        );
    }
}

#[test]
fn incremental_matches_full_rebuild_for_partial_lines_and_crlf() {
    assert_matches_full_rebuild(&[b"a\nbb", b"bb-continued\r\n", b"ccc"]);
}

#[test]
fn incremental_matches_full_rebuild_across_anchor_stride() {
    let first: String = (0..100).map(|i| format!("line-{i}\n")).collect();
    let second: String = (100..260).map(|i| format!("line-{i}\n")).collect();
    assert_matches_full_rebuild(&[first.as_bytes(), second.as_bytes()]);
}

#[cfg(unix)]
#[test]
fn truncation_is_reported_so_caller_rebuilds() {
    let file = write_temp(b"a\nbb\nccc\n");
    let index = LineIndex::open(file.path()).expect("建索引");
    std::fs::write(file.path(), b"x\n").expect("截断");
    assert!(index.extend().expect("增量").is_none());
}
