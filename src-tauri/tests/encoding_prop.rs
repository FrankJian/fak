//! 编码与换行符的性质测试（SPEC §13.1.1 第 4 项）。
//!
//! 这一块的 bug 在人工测试里基本抓不到：需要恰好的字节序列才会暴露，
//! 而人不会去手敲 0xFE 0xFF 开头的半个代理对。

use fak_lib::encoding::{decode, detect, encode, EncodingLabel};
use fak_lib::line_ending::{denormalize, detect as detect_line_ending, normalize};
use fak_lib::state::LineEnding;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]

    /// 探测与解码在任意字节上都不得 panic。
    /// 用户会拖进来 .exe、.png、截断的 zip，崩溃是不可接受的。
    #[test]
    fn detect_and_decode_never_panic(bytes in proptest::collection::vec(any::<u8>(), 0..2048)) {
        let detection = detect(&bytes);
        let (text, _) = decode(&bytes, detection.label);
        // 解码结果必须是合法 UTF-8 字符串（Rust 类型系统已保证），
        // 这里顺带确认长度换算不会溢出
        prop_assert!(text.chars().count() <= text.len());

        for &label in EncodingLabel::ALL {
            let _ = decode(&bytes, label);
        }
    }

    /// 保存是稳定的：同一份文本反复走「保存 → 打开 → 保存」，字节必须收敛。
    ///
    /// 这里不断言 `decode(encode(text)) == text`，因为传统编码里存在
    /// Encoding Standard 规定的有损但无错映射（如 Shift_JIS 把 U+00A5 编成 0x5C），
    /// 那是标准行为不是 bug。真正影响用户的是「文件每存一次就变一点」。
    #[test]
    fn saving_repeatedly_converges(text in ".{0,200}") {
        for &label in EncodingLabel::ALL {
            let Ok(first) = encode(&text, label) else { continue };
            let (decoded, _) = decode(&first, label);
            let Ok(second) = encode(&decoded, label) else { continue };
            prop_assert_eq!(
                second, first,
                "{} 反复保存后字节不收敛", label.name()
            );
        }
    }

    /// UTF-8 与 UTF-16 是全覆盖编码，任意文本都必须能无损往返。
    #[test]
    fn universal_encodings_are_lossless(text in ".{0,200}") {
        for label in [
            EncodingLabel::Utf8,
            EncodingLabel::Utf8Bom,
            EncodingLabel::Utf16Le,
            EncodingLabel::Utf16Be,
        ] {
            let bytes = encode(&text, label).expect("全覆盖编码不该失败");
            let (decoded, had_errors) = decode(&bytes, label);
            prop_assert!(!had_errors, "{} 不该产生替换字符", label.name());
            prop_assert_eq!(decoded, text.clone(), "{} 往返不恒等", label.name());
        }
    }

    /// SPEC §4.2 约束 1：归一化后正文里不能残留任何 \r。
    #[test]
    fn normalize_leaves_no_carriage_return(text in "[a-z\r\n]{0,200}") {
        let normalized = normalize(&text);
        prop_assert!(!normalized.contains('\r'));
    }

    /// 归一化是幂等的——重复保存不能让换行符越滚越多。
    #[test]
    fn normalize_is_idempotent(text in "[a-z\r\n]{0,200}") {
        let once = normalize(&text);
        prop_assert_eq!(normalize(&once), once.clone());
    }

    /// 对使用单一换行符的文本，normalize → denormalize 必须是恒等变换。
    #[test]
    fn line_ending_round_trips(lines in proptest::collection::vec("[a-z]{0,8}", 1..40)) {
        for ending in [LineEnding::Lf, LineEnding::CrLf, LineEnding::Cr] {
            let separator = match ending {
                LineEnding::Lf => "\n",
                LineEnding::CrLf => "\r\n",
                LineEnding::Cr => "\r",
            };
            let text = lines.join(separator);
            let round_tripped = denormalize(&normalize(&text), ending);
            prop_assert_eq!(round_tripped, text.clone());
        }
    }

    /// 投票判定必须选出实际占多数的那一种。
    #[test]
    fn detection_picks_the_majority(
        crlf_count in 1usize..20,
        lf_count in 0usize..10,
    ) {
        prop_assume!(crlf_count > lf_count);
        let text = format!("{}{}", "a\r\n".repeat(crlf_count), "b\n".repeat(lf_count));
        prop_assert_eq!(detect_line_ending(&text), LineEnding::CrLf);
    }
}
