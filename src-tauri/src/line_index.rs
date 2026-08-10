//! Tier C 稀疏行索引（SPEC ADR-02、P1-04）。
//!
//! 索引只保存每 64 行一个字节偏移；视口读取与全文扫描都按需打开文件，避免在
//! Windows 上长期持有 mmap / 文件句柄而阻止日志轮转。UTF-16 的换行必须按码元
//! 边界识别，不能把汉字字节中的 `0A` 当成换行。

use crate::encoding::{decode, EncodingLabel};
use crate::error::{path_hint, AppError, AppResult};
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// 稀疏索引步长：每 N 行存一个偏移。
///
/// 1 GB / 平均 80 B 每行约 1300 万行，稠密索引约 104 MB；步长 64 压到约 1.6 MB。
const SPARSE_STRIDE: usize = 64;
const READ_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub struct LineIndex {
    path: PathBuf,
    encoding: EncodingLabel,
    /// 每 SPARSE_STRIDE 行的起始字节偏移。
    anchors: Vec<u64>,
    line_count: usize,
    max_line_len: usize,
    byte_len: u64,
    /// 换行符个数与最后一行起点。追加时从这里接着扫，不必重扫全文。
    newlines: usize,
    last_line_start: u64,
    ended_with_newline: bool,
}

#[derive(Debug, Clone)]
struct Scan {
    anchors: Vec<u64>,
    newlines: usize,
    max_line_len: usize,
    last_line_start: u64,
    ended_with_newline: bool,
}

impl Scan {
    fn fresh(encoding: EncodingLabel) -> Self {
        let start = bom_len(encoding);
        Self {
            anchors: vec![start],
            newlines: 0,
            max_line_len: 0,
            last_line_start: start,
            ended_with_newline: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Delimiter {
    None,
    Lf,
    CrLf,
}

impl Delimiter {
    fn bytes(self, encoding: EncodingLabel) -> &'static [u8] {
        match (self, encoding) {
            (Delimiter::None, _) => b"",
            (Delimiter::Lf, EncodingLabel::Utf16Le) => b"\x0A\x00",
            (Delimiter::CrLf, EncodingLabel::Utf16Le) => b"\x0D\x00\x0A\x00",
            (Delimiter::Lf, EncodingLabel::Utf16Be) => b"\x00\x0A",
            (Delimiter::CrLf, EncodingLabel::Utf16Be) => b"\x00\x0D\x00\x0A",
            (Delimiter::Lf, _) => b"\n",
            (Delimiter::CrLf, _) => b"\r\n",
        }
    }
}

fn bom_len(encoding: EncodingLabel) -> u64 {
    match encoding {
        EncodingLabel::Utf8Bom => 3,
        EncodingLabel::Utf16Le | EncodingLabel::Utf16Be => 2,
        _ => 0,
    }
}

fn trim_preview(text: &str) -> String {
    let mut end = text.len().min(crate::constants::LINE_PREVIEW_MAX_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// 读取一行，正文不含 CR/LF，分隔符单独返回。返回 false 表示已到 EOF。
fn read_raw_line<R: BufRead>(
    reader: &mut R,
    encoding: EncodingLabel,
    buffer: &mut Vec<u8>,
) -> std::io::Result<Option<Delimiter>> {
    buffer.clear();
    if !matches!(encoding, EncodingLabel::Utf16Le | EncodingLabel::Utf16Be) {
        let read = reader.read_until(b'\n', buffer)?;
        if read == 0 {
            return Ok(None);
        }
        if buffer.last() != Some(&b'\n') {
            return Ok(Some(Delimiter::None));
        }
        buffer.pop();
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
            return Ok(Some(Delimiter::CrLf));
        }
        return Ok(Some(Delimiter::Lf));
    }

    let little_endian = encoding == EncodingLabel::Utf16Le;
    let mut unit = [0u8; 2];
    loop {
        if reader.read(&mut unit[..1])? == 0 {
            return Ok((!buffer.is_empty()).then_some(Delimiter::None));
        }
        if reader.read(&mut unit[1..])? == 0 {
            // 奇数字节的损坏文件仍把尾字节交给解码器显示替换字符。
            buffer.push(unit[0]);
            return Ok(Some(Delimiter::None));
        }
        let value = if little_endian {
            u16::from_le_bytes(unit)
        } else {
            u16::from_be_bytes(unit)
        };
        if value == 0x000A {
            let cr = if little_endian {
                [0x0D, 0x00]
            } else {
                [0x00, 0x0D]
            };
            if buffer.ends_with(&cr) {
                buffer.truncate(buffer.len() - 2);
                return Ok(Some(Delimiter::CrLf));
            }
            return Ok(Some(Delimiter::Lf));
        }
        buffer.extend_from_slice(&unit);
    }
}

fn scan_file(path: &Path, encoding: EncodingLabel, mut state: Scan) -> AppResult<(Scan, u64)> {
    let file = File::open(path).map_err(|error| AppError::from_io(&error, path))?;
    let byte_len = file
        .metadata()
        .map_err(|error| AppError::from_io(&error, path))?
        .len();
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
    reader
        .seek(SeekFrom::Start(state.last_line_start))
        .map_err(|error| AppError::from_io(&error, path))?;
    let mut raw = Vec::new();
    let mut line_start = state.last_line_start;

    while let Some(delimiter) = read_raw_line(&mut reader, encoding, &mut raw)
        .map_err(|error| AppError::from_io(&error, path))?
    {
        state.max_line_len = state.max_line_len.max(raw.len());
        let next = reader
            .stream_position()
            .map_err(|error| AppError::from_io(&error, path))?;
        if delimiter == Delimiter::None {
            state.last_line_start = line_start;
            state.ended_with_newline = false;
            break;
        }
        state.newlines += 1;
        if state.newlines.is_multiple_of(SPARSE_STRIDE) {
            state.anchors.push(next);
        }
        line_start = next;
        state.last_line_start = next;
        state.ended_with_newline = true;
    }
    Ok((state, byte_len))
}

fn line_count_of(byte_len: u64, encoding: EncodingLabel, scan: &Scan) -> usize {
    if byte_len <= bom_len(encoding) {
        1
    } else if scan.ended_with_newline {
        scan.newlines
    } else {
        scan.newlines + 1
    }
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
        Self::open_with_encoding(path, EncodingLabel::Utf8)
    }

    pub fn open_with_encoding(path: impl AsRef<Path>, encoding: EncodingLabel) -> AppResult<Self> {
        let path = path.as_ref();
        let started = Instant::now();
        let (scan, byte_len) = scan_file(path, encoding, Scan::fresh(encoding))?;
        let line_count = line_count_of(byte_len, encoding, &scan);
        log::info!(
            "line index built: {} lines, {} anchors, {:.0} ms",
            line_count,
            scan.anchors.len(),
            started.elapsed().as_secs_f64() * 1000.0
        );
        Ok(Self::assemble(path.to_path_buf(), encoding, scan, byte_len))
    }

    /// 文件被追加后只扫最后一个未完成行之后的字节（SPEC F16 / P4-04）。
    pub fn extend(&self) -> AppResult<Option<Self>> {
        let current_len = std::fs::metadata(&self.path)
            .map_err(|error| AppError::from_io(&error, &self.path))?
            .len();
        if current_len < self.byte_len {
            return Ok(None);
        }
        let (scan, byte_len) = scan_file(
            &self.path,
            self.encoding,
            Scan {
                anchors: self.anchors.clone(),
                newlines: self.newlines,
                max_line_len: self.max_line_len,
                last_line_start: self.last_line_start,
                ended_with_newline: self.ended_with_newline,
            },
        )?;
        Ok(Some(Self::assemble(
            self.path.clone(),
            self.encoding,
            scan,
            byte_len,
        )))
    }

    fn assemble(path: PathBuf, encoding: EncodingLabel, scan: Scan, byte_len: u64) -> Self {
        Self {
            line_count: line_count_of(byte_len, encoding, &scan),
            path,
            encoding,
            anchors: scan.anchors,
            max_line_len: scan.max_line_len,
            byte_len,
            newlines: scan.newlines,
            last_line_start: scan.last_line_start,
            ended_with_newline: scan.ended_with_newline,
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

    pub fn max_line_len(&self) -> usize {
        self.max_line_len
    }

    pub fn encoding(&self) -> EncodingLabel {
        self.encoding
    }

    pub fn path_hint(&self) -> String {
        path_hint(&self.path)
    }

    /// 行首字节偏移：从最近锚点按需打开文件，最多跳过 SPARSE_STRIDE 行。
    fn line_start(&self, line: usize) -> AppResult<Option<u64>> {
        if line >= self.line_count {
            return Ok(None);
        }
        let anchor_index = line / SPARSE_STRIDE;
        let offset = *self
            .anchors
            .get(anchor_index)
            .ok_or(AppError::Io { os_code: None })?;
        let file = File::open(&self.path).map_err(|error| AppError::from_io(&error, &self.path))?;
        let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
        reader
            .seek(SeekFrom::Start(offset))
            .map_err(|error| AppError::from_io(&error, &self.path))?;
        let available = self.byte_len.saturating_sub(offset);
        let mut reader = reader.take(available);
        let mut raw = Vec::new();
        for _ in anchor_index * SPARSE_STRIDE..line {
            if read_raw_line(&mut reader, self.encoding, &mut raw)
                .map_err(|error| AppError::from_io(&error, &self.path))?
                .is_none()
            {
                return Ok(None);
            }
        }
        Ok(Some(offset + available.saturating_sub(reader.limit())))
    }

    pub fn read_lines(&self, start: usize, count: usize) -> AppResult<LineWindow> {
        let started = Instant::now();
        let mut lines = Vec::with_capacity(count);
        let Some(offset) = self.line_start(start)? else {
            return Ok(LineWindow {
                start_line: start,
                lines,
                read_ms: 0.0,
            });
        };
        let file = File::open(&self.path).map_err(|error| AppError::from_io(&error, &self.path))?;
        let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
        reader
            .seek(SeekFrom::Start(offset))
            .map_err(|error| AppError::from_io(&error, &self.path))?;
        let mut reader = reader.take(self.byte_len.saturating_sub(offset));
        let mut raw = Vec::new();
        for _ in 0..count {
            if read_raw_line(&mut reader, self.encoding, &mut raw)
                .map_err(|error| AppError::from_io(&error, &self.path))?
                .is_none()
            {
                break;
            }
            lines.push(trim_preview(&decode(&raw, self.encoding).0));
        }
        Ok(LineWindow {
            start_line: start,
            lines,
            read_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }

    /// 从 `from` 行起逐行回调，正文不做预览截断。
    pub fn for_each_line<F>(&self, from: usize, mut visit: F) -> AppResult<()>
    where
        F: FnMut(usize, &str) -> bool,
    {
        self.for_each_raw_line(from, |line, raw, _, encoding| {
            let text = decode(raw, encoding).0;
            visit(line, &text)
        })
    }

    /// 流式导出需要保留原始字节与换行，因此提供只在 Rust 内使用的原始行遍历。
    pub fn for_each_raw_line<F>(&self, from: usize, mut visit: F) -> AppResult<()>
    where
        F: FnMut(usize, &[u8], &[u8], EncodingLabel) -> bool,
    {
        let Some(offset) = self.line_start(from)? else {
            return Ok(());
        };
        let file = File::open(&self.path).map_err(|error| AppError::from_io(&error, &self.path))?;
        let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
        reader
            .seek(SeekFrom::Start(offset))
            .map_err(|error| AppError::from_io(&error, &self.path))?;
        let mut reader = reader.take(self.byte_len.saturating_sub(offset));
        let mut raw = Vec::new();
        let mut line = from;
        while let Some(delimiter) = read_raw_line(&mut reader, self.encoding, &mut raw)
            .map_err(|error| AppError::from_io(&error, &self.path))?
        {
            if !visit(line, &raw, delimiter.bytes(self.encoding), self.encoding) {
                break;
            }
            line += 1;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
