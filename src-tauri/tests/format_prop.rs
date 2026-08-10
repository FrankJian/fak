//! 格式化幂等性的性质测试（SPEC §13.1.1 第 5 条、任务 P4-06 验收第 1 条）。
//!
//! 判据：`beautify(minify(x)) == beautify(x)`。
//!
//! 这条式子钉死的是「压缩只该丢空白，不该丢信息」。手写用例覆盖不到的是嵌套
//! 与转义的组合——恰恰是词法器最容易错的地方：字符串里的 `{`、转义引号后面的
//! `"`、空容器与非空容器相邻。错了不会崩，只会让某一层缩进悄悄少一级。
//!
//! 生成的是**合法 JSON**：非法输入两边都会报错，比不出幂等性。

use fak_lib::format::{beautify, minify, FormatSyntax};
use proptest::prelude::*;

/// 值故意取自一个很小的集合，但要覆盖「排版时需要特殊处理」的每一类：
/// 空容器不该被拆行、字符串里的括号不该被当结构、数字写法不该被改写。
fn value() -> impl Strategy<Value = String> {
    let leaf = prop_oneof![
        Just("null".to_string()),
        Just("true".to_string()),
        Just("1.50".to_string()),
        Just("1e3".to_string()),
        Just("-0".to_string()),
        Just(r#""plain""#.to_string()),
        Just(r#""with {brace} and [bracket]""#.to_string()),
        Just(r#""escaped \" quote""#.to_string()),
        Just(r#""中文与 emoji 🙂""#.to_string()),
        Just("{}".to_string()),
        Just("[]".to_string()),
    ];

    leaf.prop_recursive(4, 24, 4, |inner| {
        prop_oneof![
            proptest::collection::vec(inner.clone(), 0..4)
                .prop_map(|items| format!("[{}]", items.join(","))),
            proptest::collection::vec(inner, 0..4).prop_map(|items| {
                let fields: Vec<String> = items
                    .into_iter()
                    .enumerate()
                    .map(|(index, item)| format!(r#""k{index}":{item}"#))
                    .collect();
                format!("{{{}}}", fields.join(","))
            }),
        ]
    })
}

proptest! {
    #[test]
    fn beautify_of_minify_equals_beautify(source in value()) {
        let once = beautify(&source, FormatSyntax::Json, 2, false).expect("格式化");
        let compact = minify(&source, FormatSyntax::Json).expect("压缩");
        let twice = beautify(&compact, FormatSyntax::Json, 2, false).expect("格式化");
        prop_assert_eq!(once, twice);
    }

    /// 格式化必须收敛：再跑一次不该继续变。做不到的话，「保存时格式化」会
    /// 让文件在每次保存时都产生一次假改动。
    #[test]
    fn beautify_is_idempotent(source in value()) {
        let once = beautify(&source, FormatSyntax::Json, 2, false).expect("格式化");
        let twice = beautify(&once, FormatSyntax::Json, 2, false).expect("格式化");
        prop_assert_eq!(once, twice);
    }

    /// 压缩同样必须收敛，且不改变字面量本身。
    #[test]
    fn minify_is_idempotent(source in value()) {
        let once = minify(&source, FormatSyntax::Json).expect("压缩");
        let twice = minify(&once, FormatSyntax::Json).expect("压缩");
        prop_assert_eq!(once, twice);
    }
}
