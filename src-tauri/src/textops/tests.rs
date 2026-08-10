use super::*;

#[test]
fn western_words_split_on_whitespace() {
    assert_eq!(count_words("hello world"), 2);
    assert_eq!(count_words("  hello   world  "), 2);
    assert_eq!(count_words(""), 0);
}

#[test]
fn punctuation_does_not_become_its_own_word() {
    // 「Hello, world!」是两个词：逗号与叹号跟着前一个词
    assert_eq!(count_words("Hello, world!"), 2);
}

// SPEC F9.3：中文按字计数，不按空格分词
#[test]
fn chinese_counts_one_word_per_character() {
    assert_eq!(count_words("你好世界"), 4);
    assert_eq!(count_words("你好 world"), 3);
}

#[test]
fn japanese_and_korean_count_like_chinese() {
    assert_eq!(count_words("こんにちは"), 5);
    assert_eq!(count_words("안녕하세요"), 5);
}

#[test]
fn characters_beyond_the_basic_plane_count_once() {
    // emoji 是一个标量但四个字节，两个口径不能混
    let counted = word_count("a😀");
    assert_eq!(counted.characters, 2);
    assert_eq!(counted.bytes, 5);
}

#[test]
fn blank_lines_separate_paragraphs() {
    assert_eq!(count_paragraphs("a\nb\n\nc"), 2);
    assert_eq!(count_paragraphs("a\n   \nb"), 2);
    assert_eq!(count_paragraphs("\n\n\n"), 0);
}

#[test]
fn a_trailing_newline_does_not_add_a_line() {
    assert_eq!(count_lines("a\n"), 1);
    assert_eq!(count_lines("a\nb"), 2);
    assert_eq!(count_lines(""), 0);
}

#[test]
fn spaces_are_excluded_from_the_no_space_count() {
    let counted = word_count("a b\tc\n");
    assert_eq!(counted.characters, 6);
    assert_eq!(counted.characters_no_spaces, 3);
}
