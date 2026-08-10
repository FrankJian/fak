//! 编码探测与转换（SPEC F1.2、§4.2 约束 1 与 4）。
//!
//! 本模块存在的核心理由是 SPEC §4.2 约束 4 那对**容易被混为一谈**的操作：
//!   - `convert`：只改保存时使用的字节编码，**不重新解码**内存中的文本；
//!   - `reopen`：从磁盘原始字节**重新解码**。
//!
//! 只有后者能修复「探测错了，中文全是乱码」。缺了它用户无路可走。

use crate::error::{AppError, AppResult};
use encoding_rs::Encoding;
use serde::{Deserialize, Serialize};

/// 探测置信度。`Low` 时状态栏要给提示态，引导用户重新打开（SPEC F1.2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Confidence {
    /// 有 BOM，不存在歧义
    High,
    Medium,
    Low,
}

/// 编码标签。BOM 与否是**独立选项**而非附加开关（SPEC F1.2），
/// 所以 UTF-8 与 UTF-8-BOM 在这里是两个不同的值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EncodingLabel {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Gbk,
    Gb18030,
    Big5,
    ShiftJis,
    EucKr,
    Windows1252,
}

impl EncodingLabel {
    /// SPEC F1.2 支持清单。GB2312 与 ANSI 分别作为 GBK / windows-1252 的别名。
    pub const ALL: &'static [EncodingLabel] = &[
        EncodingLabel::Utf8,
        EncodingLabel::Utf8Bom,
        EncodingLabel::Utf16Le,
        EncodingLabel::Utf16Be,
        EncodingLabel::Gbk,
        EncodingLabel::Gb18030,
        EncodingLabel::Big5,
        EncodingLabel::ShiftJis,
        EncodingLabel::EucKr,
        EncodingLabel::Windows1252,
    ];

    pub fn encoding(self) -> &'static Encoding {
        match self {
            EncodingLabel::Utf8 | EncodingLabel::Utf8Bom => encoding_rs::UTF_8,
            EncodingLabel::Utf16Le => encoding_rs::UTF_16LE,
            EncodingLabel::Utf16Be => encoding_rs::UTF_16BE,
            // GB2312 在 encoding_rs 里就是 GBK
            EncodingLabel::Gbk => encoding_rs::GBK,
            EncodingLabel::Gb18030 => encoding_rs::GB18030,
            EncodingLabel::Big5 => encoding_rs::BIG5,
            EncodingLabel::ShiftJis => encoding_rs::SHIFT_JIS,
            EncodingLabel::EucKr => encoding_rs::EUC_KR,
            EncodingLabel::Windows1252 => encoding_rs::WINDOWS_1252,
        }
    }

    pub fn has_bom(self) -> bool {
        matches!(
            self,
            EncodingLabel::Utf8Bom | EncodingLabel::Utf16Le | EncodingLabel::Utf16Be
        )
    }

    pub fn from_name(name: &str) -> AppResult<Self> {
        let normalized = name.to_ascii_lowercase().replace(['_', ' '], "-");
        let label = match normalized.as_str() {
            "utf-8" | "utf8" => EncodingLabel::Utf8,
            "utf-8-bom" | "utf-8-with-bom" | "utf8bom" => EncodingLabel::Utf8Bom,
            "utf-16le" | "utf-16-le" => EncodingLabel::Utf16Le,
            "utf-16be" | "utf-16-be" => EncodingLabel::Utf16Be,
            "gbk" | "gb2312" => EncodingLabel::Gbk,
            "gb18030" => EncodingLabel::Gb18030,
            "big5" => EncodingLabel::Big5,
            "shift-jis" | "shift-jis-x0213" | "sjis" => EncodingLabel::ShiftJis,
            "euc-kr" => EncodingLabel::EucKr,
            "windows-1252" | "ansi" | "iso-8859-1" | "latin1" => EncodingLabel::Windows1252,
            _ => {
                return Err(AppError::EncodingUnsupported {
                    label: name.to_string(),
                })
            }
        };
        Ok(label)
    }

    pub fn name(self) -> &'static str {
        match self {
            EncodingLabel::Utf8 => "UTF-8",
            EncodingLabel::Utf8Bom => "UTF-8 with BOM",
            EncodingLabel::Utf16Le => "UTF-16 LE",
            EncodingLabel::Utf16Be => "UTF-16 BE",
            EncodingLabel::Gbk => "GBK",
            EncodingLabel::Gb18030 => "GB18030",
            EncodingLabel::Big5 => "Big5",
            EncodingLabel::ShiftJis => "Shift_JIS",
            EncodingLabel::EucKr => "EUC-KR",
            EncodingLabel::Windows1252 => "windows-1252",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub label: EncodingLabel,
    pub confidence: Confidence,
}

/// BOM 一旦命中就是确定的，无需再猜。
fn detect_bom(bytes: &[u8]) -> Option<EncodingLabel> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some(EncodingLabel::Utf8Bom)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some(EncodingLabel::Utf16Le)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some(EncodingLabel::Utf16Be)
    } else {
        None
    }
}

fn label_for(encoding: &'static Encoding) -> EncodingLabel {
    match encoding.name() {
        "GBK" => EncodingLabel::Gbk,
        "gb18030" => EncodingLabel::Gb18030,
        "Big5" => EncodingLabel::Big5,
        "Shift_JIS" => EncodingLabel::ShiftJis,
        "EUC-KR" => EncodingLabel::EucKr,
        "windows-1252" => EncodingLabel::Windows1252,
        "UTF-16LE" => EncodingLabel::Utf16Le,
        "UTF-16BE" => EncodingLabel::Utf16Be,
        _ => EncodingLabel::Utf8,
    }
}

/// 探测顺序：BOM → chardetng（采样前 1 MiB）。SPEC F1.2。
pub fn detect(bytes: &[u8]) -> Detection {
    if let Some(label) = detect_bom(bytes) {
        return Detection {
            label,
            confidence: Confidence::High,
        };
    }

    let sample = &bytes[..bytes.len().min(crate::constants::ENCODING_DETECT_SAMPLE)];

    // 合法 UTF-8 几乎不可能是别的编码误撞出来的，直接采信
    if std::str::from_utf8(sample).is_ok() {
        return Detection {
            label: EncodingLabel::Utf8,
            confidence: if sample.is_ascii() {
                // 纯 ASCII 在所有单字节编码下字节相同，谈不上「探测对了」
                Confidence::Medium
            } else {
                Confidence::High
            },
        };
    }

    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(sample, true);
    // 已经确认不是合法 UTF-8，所以这里不必再让 chardetng 猜 UTF-8
    let guess = detector.guess(None, chardetng::Utf8Detection::Deny);
    let label = label_for(guess);

    // chardetng 只给编码不给置信度，置信度得自己推：
    // windows-1252 能解码任意字节，猜到它等于「没猜出来」；
    // 猜到多字节编码却仍然解出替换字符，说明猜错了。
    let (_, had_errors) = decode(sample, label);
    let confidence = if label == EncodingLabel::Windows1252 || had_errors {
        Confidence::Low
    } else {
        Confidence::Medium
    };

    Detection { label, confidence }
}

/// 按指定编码解码。
///
/// BOM 只在选定编码本身带 BOM 时才剥离。用 `Encoding::decode` 会无条件吞掉
/// 开头的 BOM 字节，于是正文首字符恰好是 U+FEFF 的文档每存一次就少一个字符；
/// 而对 GBK 这类编码，开头的 EF BB BF 是三个正常汉字字节，更不能当 BOM 吃掉。
///
/// 返回 `had_errors` 让调用方知道出现了替换字符——但**不因此报错**：
/// 用户宁可看到部分乱码也不愿意打不开文件，何况他还能重新指定编码。
pub fn decode(bytes: &[u8], label: EncodingLabel) -> (String, bool) {
    let encoding = label.encoding();
    let (text, had_errors) = if label.has_bom() {
        encoding.decode_with_bom_removal(bytes)
    } else {
        encoding.decode_without_bom_handling(bytes)
    };
    (text.into_owned(), had_errors)
}

/// 按指定编码编码。
///
/// UTF-16 必须手写：encoding_rs 遵循 Encoding Standard「输出编码永不为 UTF-16」，
/// 对 `UTF_16LE.encode()` 会**静默回落成 UTF-8**。直接用它会写出错误的文件。
/// UTF-8 with BOM 同样要手工补 BOM，encoding_rs 的编码器不写 BOM。
pub fn bom_bytes(label: EncodingLabel) -> &'static [u8] {
    match label {
        EncodingLabel::Utf8Bom => &[0xEF, 0xBB, 0xBF],
        EncodingLabel::Utf16Le => &[0xFF, 0xFE],
        EncodingLabel::Utf16Be => &[0xFE, 0xFF],
        _ => &[],
    }
}

/// 编码正文片段但不写 BOM。流式变换逐行调用，BOM 只能在文件开头写一次。
pub fn encode_fragment(text: &str, label: EncodingLabel) -> AppResult<Vec<u8>> {
    if matches!(label, EncodingLabel::Utf16Le | EncodingLabel::Utf16Be) {
        let big_endian = label == EncodingLabel::Utf16Be;
        let mut out = Vec::with_capacity(text.len() * 2);
        for unit in text.encode_utf16() {
            if big_endian {
                out.extend_from_slice(&unit.to_be_bytes());
            } else {
                out.extend_from_slice(&unit.to_le_bytes());
            }
        }
        return Ok(out);
    }

    let (bytes, _, had_errors) = label.encoding().encode(text);
    if had_errors {
        return Err(AppError::EncodingUnsupported {
            label: label.name().to_string(),
        });
    }
    Ok(bytes.into_owned())
}

pub fn encode(text: &str, label: EncodingLabel) -> AppResult<Vec<u8>> {
    let fragment = encode_fragment(text, label)?;
    let mut out = Vec::with_capacity(fragment.len() + bom_bytes(label).len());
    out.extend_from_slice(bom_bytes(label));
    out.extend_from_slice(&fragment);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bom_wins_over_guessing() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("中文".as_bytes());
        let detection = detect(&bytes);
        assert_eq!(detection.label, EncodingLabel::Utf8Bom);
        assert_eq!(detection.confidence, Confidence::High);
    }

    #[test]
    fn utf16_boms_are_recognized() {
        assert_eq!(
            detect(&[0xFF, 0xFE, 0x41, 0x00]).label,
            EncodingLabel::Utf16Le
        );
        assert_eq!(
            detect(&[0xFE, 0xFF, 0x00, 0x41]).label,
            EncodingLabel::Utf16Be
        );
    }

    #[test]
    fn pure_ascii_is_only_medium_confidence() {
        // ASCII 在所有单字节编码下字节相同，说「探测到 UTF-8」是过度自信
        assert_eq!(detect(b"hello world").confidence, Confidence::Medium);
    }

    #[test]
    fn valid_utf8_with_multibyte_is_high_confidence() {
        assert_eq!(detect("中文内容".as_bytes()).confidence, Confidence::High);
    }

    #[test]
    fn gbk_bytes_are_not_mistaken_for_utf8() {
        let (bytes, _, _) = encoding_rs::GBK.encode("简体中文测试内容，用于编码探测");
        let detection = detect(&bytes);
        assert_ne!(
            detection.label,
            EncodingLabel::Utf8,
            "GBK 字节不是合法 UTF-8，不该被当成 UTF-8"
        );
    }

    #[test]
    fn round_trip_preserves_bytes_for_every_label() {
        let text = "abc 123";
        for &label in EncodingLabel::ALL {
            let bytes = encode(text, label).expect("编码");
            let (decoded, _) = decode(&bytes, label);
            assert_eq!(decoded, text, "{} 往返不一致", label.name());
        }
    }

    #[test]
    fn cjk_round_trips_through_chinese_encodings() {
        let text = "中文简体与繁體字";
        for label in [
            EncodingLabel::Utf8,
            EncodingLabel::Utf8Bom,
            EncodingLabel::Gbk,
            EncodingLabel::Gb18030,
            EncodingLabel::Utf16Le,
            EncodingLabel::Utf16Be,
        ] {
            let bytes = encode(text, label).expect("编码");
            let (decoded, had_errors) = decode(&bytes, label);
            assert!(!had_errors, "{} 不该有替换字符", label.name());
            assert_eq!(decoded, text, "{} 往返不一致", label.name());
        }
    }

    #[test]
    fn utf8_bom_is_written_and_stripped() {
        let bytes = encode("A", EncodingLabel::Utf8Bom).expect("编码");
        assert_eq!(&bytes[..3], &[0xEF, 0xBB, 0xBF]);
        let (decoded, _) = decode(&bytes, EncodingLabel::Utf8Bom);
        assert_eq!(decoded, "A", "解码时 BOM 必须被剥离，不能留成零宽字符");
    }

    #[test]
    fn unencodable_char_reports_structured_error() {
        // emoji 在 GBK 里没有对应字节
        let error = encode("🙈", EncodingLabel::Gbk).expect_err("应当报错");
        assert!(matches!(error, AppError::EncodingUnsupported { .. }));
    }

    #[test]
    fn misdetected_gbk_can_be_recovered_by_reopening() {
        // 这条模拟 SPEC F1.2 说的自救路径：GBK 被误判成 windows-1252 时全是乱码，
        // 用正确编码重新解码同一批字节即可恢复
        let original = "中文日志";
        let (bytes, _, _) = encoding_rs::GBK.encode(original);
        let (garbled, _) = decode(&bytes, EncodingLabel::Windows1252);
        assert_ne!(garbled, original);
        let (recovered, _) = decode(&bytes, EncodingLabel::Gbk);
        assert_eq!(recovered, original);
    }

    #[test]
    fn leading_feff_in_content_is_not_eaten_as_a_bom() {
        // 回归测试（proptest 抓到的）：正文首字符恰好是 U+FEFF 时，
        // 以无 BOM 的 UTF-8 保存再打开，这个字符不能凭空消失
        let text = "\u{feff}正文";
        let bytes = encode(text, EncodingLabel::Utf8).expect("编码");
        let (decoded, _) = decode(&bytes, EncodingLabel::Utf8);
        assert_eq!(decoded, text);
    }

    #[test]
    fn gbk_bytes_that_look_like_a_utf8_bom_survive() {
        // EF BB BF 在 GBK 里是两个正常汉字的字节，不是 BOM
        let (bytes, _, _) = encoding_rs::GBK.encode("汉字内容");
        let (decoded, _) = decode(&bytes, EncodingLabel::Gbk);
        assert_eq!(decoded, "汉字内容");
    }

    #[test]
    fn utf16_is_really_utf16_not_utf8_fallback() {
        // 回归测试：encoding_rs 的 encode() 对 UTF-16 会静默回落成 UTF-8，
        // 直接用它会写出后缀是 .txt 但内容对不上的文件
        let bytes = encode("A", EncodingLabel::Utf16Le).expect("编码");
        assert_eq!(bytes, vec![0xFF, 0xFE, 0x41, 0x00]);
        let bytes = encode("A", EncodingLabel::Utf16Be).expect("编码");
        assert_eq!(bytes, vec![0xFE, 0xFF, 0x00, 0x41]);
    }

    #[test]
    fn astral_plane_chars_survive_utf16() {
        let text = "🙈🙉";
        for label in [EncodingLabel::Utf16Le, EncodingLabel::Utf16Be] {
            let bytes = encode(text, label).expect("编码");
            let (decoded, _) = decode(&bytes, label);
            assert_eq!(decoded, text, "{} 代理对往返不一致", label.name());
        }
    }

    #[test]
    fn unknown_encoding_name_is_rejected() {
        assert!(EncodingLabel::from_name("klingon").is_err());
    }

    #[test]
    fn encoding_aliases_resolve() {
        assert_eq!(
            EncodingLabel::from_name("GB2312").expect("别名"),
            EncodingLabel::Gbk
        );
        assert_eq!(
            EncodingLabel::from_name("ANSI").expect("别名"),
            EncodingLabel::Windows1252
        );
        assert_eq!(
            EncodingLabel::from_name("iso-8859-1").expect("别名"),
            EncodingLabel::Windows1252
        );
    }

    #[test]
    fn decoding_never_panics_on_arbitrary_bytes() {
        let nasty: Vec<u8> = (0u8..=255).cycle().take(4096).collect();
        for &label in EncodingLabel::ALL {
            let (text, _) = decode(&nasty, label);
            assert!(text.is_char_boundary(0) || text.is_empty());
        }
    }
}
