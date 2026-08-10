use crate::encoding::EncodingLabel;
use crate::error::{path_hint, AppError, AppResult};
use crate::search::{preserve_case, MatchMode, SearchOptions};
use regex::{Captures, Regex};
use std::path::{Path, PathBuf};

const PREVIEW_BYTES: usize = 512;

pub(super) fn preview_text(text: &str) -> String {
    let mut end = text.len().min(PREVIEW_BYTES);
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

pub(super) fn replacement_for_line(
    replacement: &str,
    delimiter: &[u8],
    encoding: EncodingLabel,
) -> String {
    let line_ending = match (encoding, delimiter) {
        (EncodingLabel::Utf16Le, b"\x0D\x00\x0A\x00")
        | (EncodingLabel::Utf16Be, b"\x00\x0D\x00\x0A")
        | (_, b"\r\n") => "\r\n",
        _ => "\n",
    };
    replacement
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', line_ending)
}

fn expanded(captures: &Captures<'_>, replacement: &str, mode: MatchMode) -> String {
    if mode != MatchMode::Regex {
        return replacement.to_string();
    }
    let mut output = String::new();
    captures.expand(replacement, &mut output);
    output
}

pub(super) fn replace_line(
    text: &str,
    regex: &Regex,
    replacement: &str,
    options: SearchOptions,
    preserve_original_case: bool,
) -> (Option<String>, usize) {
    let mut output = String::new();
    let mut cursor = 0usize;
    let mut count = 0usize;
    for captures in regex.captures_iter(text) {
        let Some(found) = captures.get(0) else {
            continue;
        };
        if found.is_empty() {
            continue;
        }
        output.push_str(&text[cursor..found.start()]);
        let mut insert = expanded(&captures, replacement, options.mode);
        if preserve_original_case && options.mode == MatchMode::Literal {
            insert = preserve_case(found.as_str(), &insert);
        }
        output.push_str(&insert);
        cursor = found.end();
        count += 1;
    }
    if count == 0 {
        return (None, 0);
    }
    output.push_str(&text[cursor..]);
    (Some(output), count)
}

pub(super) fn validated_output_path(source: &Path, requested: &Path) -> AppResult<PathBuf> {
    let file_name = requested.file_name().ok_or_else(|| AppError::InvalidPath {
        path_hint: path_hint(requested),
    })?;
    if requested
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(AppError::PermissionDenied {
            path_hint: path_hint(requested),
        });
    }
    let parent = requested.parent().unwrap_or_else(|| Path::new("."));
    let parent =
        std::fs::canonicalize(parent).map_err(|error| AppError::from_io(&error, requested))?;
    let target = parent.join(file_name);
    let canonical_source =
        std::fs::canonicalize(source).map_err(|error| AppError::from_io(&error, source))?;
    if target == canonical_source {
        return Err(AppError::InvalidPath {
            path_hint: path_hint(requested),
        });
    }
    if target.is_dir() {
        return Err(AppError::IsDirectory {
            path_hint: path_hint(&target),
        });
    }
    Ok(target)
}
