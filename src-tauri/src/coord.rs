//! 坐标换算（SPEC §4.2 约束 5）。
//!
//! 三套坐标同时存在，换算错了不会崩，只会让光标、选区、高亮悄悄偏移几格：
//!   - **char 索引**：Rust 侧的唯一内部坐标，rope 的原生单位；
//!   - **UTF-16 code unit**：编辑器内核（CM6）的坐标系，emoji 占 2 个单位；
//!   - **(行, 列)**：前端传进来的坐标，列同样以 UTF-16 code unit 计。
//!
//! 所有函数一律**钳制**越界输入而不是 panic，且结果永远落在字符边界上——
//! 绝不会把一个代理对或组合序列从中间切开。

use ropey::Rope;
use serde::{Deserialize, Serialize};

/// 前端坐标：行号从 0 起，列以 UTF-16 code unit 计。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub line: usize,
    pub column_utf16: usize,
}

impl Position {
    pub fn new(line: usize, column_utf16: usize) -> Self {
        Self { line, column_utf16 }
    }
}

/// 文档内的 UTF-16 偏移 → char 索引。
pub fn utf16_to_char(rope: &Rope, utf16_offset: usize) -> usize {
    let clamped = utf16_offset.min(rope.len_utf16_cu());
    rope.utf16_cu_to_char(clamped)
}

/// char 索引 → 文档内的 UTF-16 偏移。
pub fn char_to_utf16(rope: &Rope, char_idx: usize) -> usize {
    rope.char_to_utf16_cu(char_idx.min(rope.len_chars()))
}

/// (行, 列) → char 索引。
///
/// 越界的行钳到最后一行、越界的列钳到行尾；列落在代理对中间时向下取整到
/// 该字符的起点，因此返回值必定是合法的 char 索引。
pub fn position_to_char(rope: &Rope, position: Position) -> usize {
    let last_line = rope.len_lines().saturating_sub(1);
    let line = position.line.min(last_line);
    let line_start = rope.line_to_char(line);
    let line_slice = rope.line(line);

    let column = position.column_utf16.min(line_slice.len_utf16_cu());
    line_start + line_slice.utf16_cu_to_char(column)
}

/// char 索引 → (行, 列)。
pub fn char_to_position(rope: &Rope, char_idx: usize) -> Position {
    let char_idx = char_idx.min(rope.len_chars());
    let line = rope.char_to_line(char_idx);
    let line_start = rope.line_to_char(line);
    Position {
        line,
        column_utf16: rope.char_to_utf16_cu(char_idx) - rope.char_to_utf16_cu(line_start),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 覆盖 SPEC §13.1.1 第 1 条点名的四类字符
    const TRICKY: &str = "a😀b\n中文ｃ\ne\u{0301}f\u{200b}g\nlast";

    fn rope() -> Rope {
        Rope::from_str(TRICKY)
    }

    #[test]
    fn emoji_counts_as_two_utf16_units() {
        let rope = rope();
        // "a" 之后是 😀（代理对），其后的 "b" 在第 3 个 UTF-16 单元上
        assert_eq!(char_to_utf16(&rope, 1), 1);
        assert_eq!(char_to_utf16(&rope, 2), 3);
    }

    #[test]
    fn utf16_offset_inside_surrogate_pair_snaps_to_char_start() {
        let rope = rope();
        // 偏移 2 落在 😀 的低位代理上，必须回到 😀 的起点而不是切开它
        assert_eq!(utf16_to_char(&rope, 2), 1);
    }

    #[test]
    fn column_is_measured_within_the_line() {
        let rope = rope();
        // 第 1 行是 "中文ｃ"，三个字符各占 1 个 UTF-16 单元
        let at = position_to_char(&rope, Position::new(1, 2));
        assert_eq!(rope.char(at), 'ｃ');
        assert_eq!(char_to_position(&rope, at), Position::new(1, 2));
    }

    #[test]
    fn combining_and_zero_width_chars_stay_separate() {
        let rope = rope();
        // "e\u{0301}f\u{200b}g"：组合重音与零宽空格各自是独立的 char
        let line = 2;
        for column in 0..5 {
            let at = position_to_char(&rope, Position::new(line, column));
            assert_eq!(char_to_position(&rope, at), Position::new(line, column));
        }
    }

    #[test]
    fn out_of_range_input_is_clamped_not_panicking() {
        let rope = rope();
        assert_eq!(
            position_to_char(&rope, Position::new(999, 999)),
            rope.len_chars()
        );
        assert_eq!(utf16_to_char(&rope, usize::MAX), rope.len_chars());
        assert_eq!(char_to_utf16(&rope, usize::MAX), rope.len_utf16_cu());
        assert_eq!(
            char_to_position(&rope, usize::MAX).line,
            rope.len_lines() - 1
        );
    }

    #[test]
    fn empty_rope_has_one_line_and_zero_offsets() {
        let rope = Rope::from_str("");
        assert_eq!(position_to_char(&rope, Position::new(0, 0)), 0);
        assert_eq!(char_to_position(&rope, 0), Position::new(0, 0));
    }

    #[test]
    fn position_at_line_end_maps_before_the_newline() {
        let rope = Rope::from_str("ab\ncd");
        let at = position_to_char(&rope, Position::new(0, 99));
        // 行末列钳到换行符之前，不会溢出到下一行
        assert_eq!(at, 3);
        assert_eq!(char_to_position(&rope, at), Position::new(1, 0));
    }
}
