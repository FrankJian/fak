//! 文本处理工具的纯函数（SPEC F9）。
//!
//! 不碰文档状态、不碰 IO，命令层调它、单测直接调它。

pub mod edits;
pub mod lines;
pub mod transcode;

use serde::Serialize;

/// 字数统计（SPEC F9.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WordCount {
    /// 词数。**CJK 按字计**，见 `count_words`
    pub words: usize,
    /// 字符数，按 Unicode 标量算（不是字节，也不是 UTF-16 码元）
    pub characters: usize,
    /// 不含任何空白的字符数
    pub characters_no_spaces: usize,
    pub lines: usize,
    /// 段落数：被空行分隔的非空文本块
    pub paragraphs: usize,
    /// 按 UTF-8 计的字节数。与落盘大小的关系还要看编码，这里只报 UTF-8
    pub bytes: usize,
}

/// 一个字符是否算作「一个词」。
///
/// 中日韩文字之间不写空格，按空白分词会把整段中文数成一个词——
/// 这正是 SPEC F9.3 要求 CJK 感知的原因。
fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x3040..=0x30FF     // 平假名 / 片假名
        | 0x3400..=0x4DBF   // 扩展 A
        | 0x4E00..=0x9FFF   // 基本区
        | 0xF900..=0xFAFF   // 兼容表意文字
        | 0xAC00..=0xD7AF   // 谚文音节
        | 0x20000..=0x2FA1F // 扩展 B 及以后
    )
}

/// 词数。CJK 一字一词，其余按空白分段。
///
/// 标点不单独计词：「Hello, world!」是两个词而不是四个。
pub fn count_words(text: &str) -> usize {
    let mut words = 0;
    // 上一个字符是否属于一个**正在进行中的**西文词
    let mut in_word = false;
    for ch in text.chars() {
        if is_cjk(ch) {
            words += 1;
            in_word = false;
        } else if ch.is_whitespace() {
            in_word = false;
        } else if !in_word {
            words += 1;
            in_word = true;
        }
    }
    words
}

/// 段落数：连续的非空行算一段，空行是分隔符。
///
/// 只由空白构成的行也当空行——用户眼里它就是空的。
pub fn count_paragraphs(text: &str) -> usize {
    let mut paragraphs = 0;
    let mut inside = false;
    for line in text.lines() {
        if line.trim().is_empty() {
            inside = false;
        } else if !inside {
            paragraphs += 1;
            inside = true;
        }
    }
    paragraphs
}

/// 行数。
///
/// 末尾有换行符时**不多算一行**：`"a\n"` 是一行，不是两行。
/// 空文本是 0 行，与状态栏那边的口径一致。
pub fn count_lines(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    text.lines().count()
}

pub fn word_count(text: &str) -> WordCount {
    WordCount {
        words: count_words(text),
        characters: text.chars().count(),
        characters_no_spaces: text.chars().filter(|ch| !ch.is_whitespace()).count(),
        lines: count_lines(text),
        paragraphs: count_paragraphs(text),
        bytes: text.len(),
    }
}

#[cfg(test)]
mod tests;
