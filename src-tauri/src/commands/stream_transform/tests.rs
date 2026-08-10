use super::*;
use crate::encoding::EncodingLabel;
use crate::search::MatchMode;

fn options(mode: MatchMode) -> SearchOptions {
    SearchOptions {
        mode,
        ..SearchOptions::default()
    }
}

#[test]
fn literal_replacement_does_not_expand_capture_syntax() {
    let regex = compile("foo", options(MatchMode::Literal)).expect("正则");
    let (text, count) = replace_line("foo foo", &regex, "$1", options(MatchMode::Literal), false);
    assert_eq!(text.as_deref(), Some("$1 $1"));
    assert_eq!(count, 2);
}

#[test]
fn regex_replacement_expands_capture_groups() {
    let regex = compile("(foo)", options(MatchMode::Regex)).expect("正则");
    let (text, count) = replace_line("foo", &regex, "<$1>", options(MatchMode::Regex), false);
    assert_eq!(text.as_deref(), Some("<foo>"));
    assert_eq!(count, 1);
}

#[test]
fn replacement_newlines_follow_source_line_ending() {
    assert_eq!(
        replacement_for_line("a\nb", b"\r\n", EncodingLabel::Utf8),
        "a\r\nb"
    );
}

#[test]
fn output_path_accepts_a_new_sibling_file() {
    let directory = tempfile::tempdir().expect("临时目录");
    let source = directory.path().join("source.log");
    std::fs::write(&source, "source").expect("源文件");
    let target = directory.path().join("filtered.log");
    assert_eq!(
        validated_output_path(&source, &target).expect("目标路径"),
        std::fs::canonicalize(directory.path())
            .expect("规范化目录")
            .join("filtered.log")
    );
}

#[test]
fn output_path_rejects_overwriting_the_source() {
    let directory = tempfile::tempdir().expect("临时目录");
    let source = directory.path().join("source.log");
    std::fs::write(&source, "source").expect("源文件");
    assert!(matches!(
        validated_output_path(&source, &source),
        Err(AppError::InvalidPath { .. })
    ));
}

#[test]
fn output_path_rejects_a_directory() {
    let directory = tempfile::tempdir().expect("临时目录");
    let source = directory.path().join("source.log");
    std::fs::write(&source, "source").expect("源文件");
    assert!(matches!(
        validated_output_path(&source, directory.path()),
        Err(AppError::IsDirectory { .. })
    ));
}
