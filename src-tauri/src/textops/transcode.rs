//! Base64 编解码（SPEC F3.3 「转换」子菜单）。

use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// 编码始终按 UTF-8 字节做。
///
/// 文档的落盘编码可能是 GBK，但 Base64 的用途几乎全是喂给别的程序，
/// 那边默认按 UTF-8 解；跟着落盘编码走只会制造难查的乱码。
pub fn encode(text: &str) -> String {
    STANDARD.encode(text.as_bytes())
}

/// 解码。非法输入与解出来不是合法 UTF-8 的，都当「格式不支持」报错。
///
/// 解码前先去掉全部空白：从别处粘来的 Base64 常带换行，
/// 让用户先手工把它接成一行是没道理的。
pub fn decode(text: &str) -> AppResult<String> {
    let compact: String = text.chars().filter(|ch| !ch.is_whitespace()).collect();
    let unsupported = || AppError::UnsupportedFormat {
        syntax: "base64".to_string(),
        operation: "decode".to_string(),
    };

    let bytes = STANDARD.decode(&compact).map_err(|_| unsupported())?;
    String::from_utf8(bytes).map_err(|_| unsupported())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_round_trips() {
        assert_eq!(encode("hello"), "aGVsbG8=");
        assert_eq!(decode("aGVsbG8=").expect("解码"), "hello");
    }

    #[test]
    fn chinese_goes_through_utf8_regardless_of_the_document_encoding() {
        let encoded = encode("你好");
        assert_eq!(encoded, "5L2g5aW9");
        assert_eq!(decode(&encoded).expect("解码"), "你好");
    }

    #[test]
    fn whitespace_inside_the_payload_is_tolerated() {
        assert_eq!(decode("aGVs\nbG8=\n").expect("解码"), "hello");
        assert_eq!(decode("  aGVsbG8=  ").expect("解码"), "hello");
    }

    #[test]
    fn empty_input_is_not_an_error() {
        assert_eq!(encode(""), "");
        assert_eq!(decode("").expect("解码"), "");
    }

    #[test]
    fn garbage_reports_a_structured_error() {
        assert!(matches!(
            decode("not base64!!").expect_err("应当失败"),
            AppError::UnsupportedFormat { .. }
        ));
    }

    #[test]
    fn valid_base64_of_non_utf8_bytes_is_still_refused() {
        // 0xFF 不是合法 UTF-8 起始字节。塞进文档只会变成替换字符，
        // 与其悄悄毁掉内容，不如明说这不是一段文本
        let encoded = STANDARD.encode([0xFF, 0xFE]);
        assert!(matches!(
            decode(&encoded).expect_err("应当失败"),
            AppError::UnsupportedFormat { .. }
        ));
    }
}
