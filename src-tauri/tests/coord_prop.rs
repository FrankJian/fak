//! SPEC §13.1.1 第 1 条：坐标换算的属性测试。
//!
//! 这类 bug 人工测基本抓不到——换算差一格时界面看着完全正常，
//! 只有在 emoji / 代理对 / 组合字符 / 零宽字符附近才暴露。

use fak_lib::coord::{char_to_position, char_to_utf16, position_to_char, utf16_to_char, Position};
use proptest::prelude::*;
use ropey::Rope;

/// 刻意堆满坑：代理对、组合字符、零宽字符、全角、CJK、换行。
fn tricky_text() -> impl Strategy<Value = String> {
    let piece = prop_oneof![
        Just("a".to_string()),
        Just("😀".to_string()),        // 代理对
        Just("👨‍👩‍👧".to_string(),),       // 带零宽连接符的组合 emoji
        Just("e\u{0301}".to_string()), // 组合重音
        Just("\u{200b}".to_string()),  // 零宽空格
        Just("中".to_string()),
        Just("ｃ".to_string()), // 全角
        Just("\n".to_string()),
        Just("\t".to_string()),
    ];
    proptest::collection::vec(piece, 0..80).prop_map(|parts| parts.concat())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]

    /// char → (行,列) → char 必须恒等。
    #[test]
    fn position_round_trip_is_identity(text in tricky_text()) {
        let rope = Rope::from_str(&text);
        for char_idx in 0..=rope.len_chars() {
            let position = char_to_position(&rope, char_idx);
            prop_assert_eq!(
                position_to_char(&rope, position),
                char_idx,
                "char {} 经 {:?} 往返后不一致",
                char_idx,
                position
            );
        }
    }

    /// char → UTF-16 → char 必须恒等。
    #[test]
    fn utf16_round_trip_is_identity(text in tricky_text()) {
        let rope = Rope::from_str(&text);
        for char_idx in 0..=rope.len_chars() {
            let utf16 = char_to_utf16(&rope, char_idx);
            prop_assert_eq!(utf16_to_char(&rope, utf16), char_idx);
        }
    }

    /// 任意 UTF-16 偏移（含落在代理对中间的）都必须换算到合法字符边界，
    /// 且不会越过它自身的位置。
    #[test]
    fn arbitrary_utf16_offsets_land_on_char_boundaries(text in tricky_text(), probe in 0usize..4096) {
        let rope = Rope::from_str(&text);
        let char_idx = utf16_to_char(&rope, probe);
        prop_assert!(char_idx <= rope.len_chars());
        // 换算回去只可能不变或变小（向下取整到字符起点），绝不会凭空前进
        prop_assert!(char_to_utf16(&rope, char_idx) <= probe.min(rope.len_utf16_cu()));
    }

    /// 任意 (行,列) —— 包括越界的 —— 都必须钳制到合法 char 索引，不得 panic。
    #[test]
    fn arbitrary_positions_are_clamped(
        text in tricky_text(),
        line in 0usize..64,
        column in 0usize..512,
    ) {
        let rope = Rope::from_str(&text);
        let char_idx = position_to_char(&rope, Position::new(line, column));
        prop_assert!(char_idx <= rope.len_chars());

        // 钳制后的位置本身必须是稳定点：再换算一次不再移动
        let position = char_to_position(&rope, char_idx);
        prop_assert_eq!(position_to_char(&rope, position), char_idx);
    }

    /// 行号必须落在合法范围内，列不得越过该行的 UTF-16 长度。
    #[test]
    fn positions_never_escape_their_line(text in tricky_text()) {
        let rope = Rope::from_str(&text);
        for char_idx in 0..=rope.len_chars() {
            let position = char_to_position(&rope, char_idx);
            prop_assert!(position.line < rope.len_lines());
            prop_assert!(position.column_utf16 <= rope.line(position.line).len_utf16_cu());
        }
    }
}
