use super::*;
use crate::syntax::{text_edit, SyntaxCache};

fn outline_of(syntax: SyntaxKey, source: &str) -> Vec<OutlineNode> {
    SyntaxCache::default()
        .with_parsed("doc", syntax, source, 1, |parsed| {
            build(&parsed.tree, &parsed.source, syntax)
        })
        .expect("大纲不该失败")
        .expect("这门语言应当有大纲")
}

fn names(nodes: &[OutlineNode]) -> Vec<&str> {
    nodes.iter().map(|node| node.name.as_str()).collect()
}

#[test]
fn typescript_lists_classes_methods_and_functions() {
    let nodes = outline_of(
        SyntaxKey::TypeScript,
        "export function top() {}\nclass Box {\n  open() {}\n}\n",
    );
    assert_eq!(names(&nodes), vec!["top", "Box", "open"]);
    assert_eq!(nodes[0].kind, SymbolKind::Function);
    assert_eq!(nodes[1].kind, SymbolKind::Class);
    assert_eq!(nodes[2].kind, SymbolKind::Method);
}

// 层级靠字节范围包含算出来，不写在查询里
#[test]
fn methods_nest_under_their_class() {
    let nodes = outline_of(SyntaxKey::TypeScript, "class Box {\n  open() {}\n}\n");
    assert_eq!(nodes[0].depth, 0);
    assert_eq!(nodes[1].depth, 1);
}

#[test]
fn a_second_class_starts_a_new_top_level() {
    let nodes = outline_of(
        SyntaxKey::TypeScript,
        "class A {\n  a() {}\n}\nclass B {\n  b() {}\n}\n",
    );
    assert_eq!(
        nodes.iter().map(|node| node.depth).collect::<Vec<_>>(),
        vec![0, 1, 0, 1]
    );
}

#[test]
fn typescript_covers_interfaces_enums_and_type_aliases() {
    let nodes = outline_of(
        SyntaxKey::TypeScript,
        "interface Shape {}\nenum Color { Red }\ntype Id = string;\n",
    );
    assert_eq!(
        nodes.iter().map(|node| node.kind).collect::<Vec<_>>(),
        vec![SymbolKind::Interface, SymbolKind::Enum, SymbolKind::Type]
    );
}

// 箭头函数常量要收，普通常量不收——否则配置文件的大纲比正文还长
#[test]
fn only_function_shaped_constants_make_the_outline() {
    let nodes = outline_of(
        SyntaxKey::TypeScript,
        "const handler = () => {};\nconst limit = 10;\n",
    );
    assert_eq!(names(&nodes), vec!["handler"]);
}

#[test]
fn rust_lists_structs_impls_and_functions() {
    let nodes = outline_of(
        SyntaxKey::Rust,
        "struct Box;\nimpl Box {\n    fn open(&self) {}\n}\nfn main() {}\n",
    );
    assert_eq!(names(&nodes), vec!["Box", "Box", "open", "main"]);
    // impl 块里的方法缩进一层
    assert_eq!(nodes[2].depth, 1);
    assert_eq!(nodes[3].depth, 0);
}

#[test]
fn rust_covers_traits_enums_modules_and_constants() {
    let nodes = outline_of(
        SyntaxKey::Rust,
        "mod inner { const N: u8 = 1; }\ntrait Draw {}\nenum Color { Red }\n",
    );
    assert_eq!(
        nodes.iter().map(|node| node.kind).collect::<Vec<_>>(),
        vec![
            SymbolKind::Module,
            SymbolKind::Constant,
            SymbolKind::Interface,
            SymbolKind::Enum
        ]
    );
}

#[test]
fn python_nests_methods_under_classes() {
    let nodes = outline_of(
        SyntaxKey::Python,
        "def top():\n    pass\n\nclass Box:\n    def open(self):\n        pass\n",
    );
    assert_eq!(names(&nodes), vec!["top", "Box", "open"]);
    assert_eq!(nodes[2].depth, 1);
}

// 装饰过的函数在语法上多包了一层，不去重会出现两条同名条目
#[test]
fn a_decorated_function_appears_once() {
    let nodes = outline_of(SyntaxKey::Python, "@cache\ndef fetch():\n    pass\n");
    assert_eq!(names(&nodes), vec!["fetch"]);
}

#[test]
fn json_keys_nest_by_object_depth() {
    let nodes = outline_of(
        SyntaxKey::Json,
        "{\n  \"a\": { \"b\": 1 },\n  \"c\": 2\n}\n",
    );
    assert_eq!(names(&nodes), vec!["a", "b", "c"]);
    assert_eq!(
        nodes.iter().map(|node| node.depth).collect::<Vec<_>>(),
        vec![0, 1, 0]
    );
}

// 键的原文带引号，显示时要剥掉
#[test]
fn json_key_names_lose_their_quotes() {
    let nodes = outline_of(SyntaxKey::Json, "{\"name\": 1}");
    assert_eq!(nodes[0].name, "name");
    assert_eq!(nodes[0].kind, SymbolKind::Key);
}

// 标题在语法树上是平铺的，层级只能从 capture 名里读
#[test]
fn markdown_headings_nest_by_their_marker_level() {
    let nodes = outline_of(
        SyntaxKey::Markdown,
        "# One\n\n## Two\n\n### Three\n\n# Four\n",
    );
    assert_eq!(names(&nodes), vec!["One", "Two", "Three", "Four"]);
    assert_eq!(
        nodes.iter().map(|node| node.depth).collect::<Vec<_>>(),
        vec![0, 1, 2, 0]
    );
    assert!(nodes.iter().all(|node| node.kind == SymbolKind::Heading));
}

#[test]
fn markdown_underlined_headings_count_too() {
    let nodes = outline_of(SyntaxKey::Markdown, "Title\n=====\n\nSub\n---\n");
    assert_eq!(names(&nodes), vec!["Title", "Sub"]);
    assert_eq!(nodes[1].depth, 1);
}

#[test]
fn line_numbers_are_zero_based() {
    let nodes = outline_of(SyntaxKey::TypeScript, "\n\nfunction third() {}\n");
    assert_eq!(nodes[0].line, 2);
}

// 偏移是 UTF-16 码元：给字节偏移会让「光标在哪个符号里」在中文文件上整体错位
#[test]
fn offsets_are_utf16_not_bytes() {
    let source = "// 中文注释\nfunction after() {}\n";
    let nodes = outline_of(SyntaxKey::TypeScript, source);
    let expected: usize = source
        .split_once("function")
        .map(|(before, _)| before.chars().map(char::len_utf16).sum())
        .expect("样例含 function");
    assert_eq!(nodes[0].start, expected);
}

#[test]
fn an_empty_file_has_an_empty_outline() {
    assert!(outline_of(SyntaxKey::TypeScript, "").is_empty());
}

#[test]
fn a_syntax_error_does_not_lose_the_rest_of_the_file() {
    // 半截代码在编辑中是常态。能认出来的部分照样要出现在大纲里
    let nodes = outline_of(
        SyntaxKey::TypeScript,
        "function ok() {}\nfunction broken(\n",
    );
    assert!(nodes.iter().any(|node| node.name == "ok"));
}

#[test]
fn long_names_are_truncated_not_dropped() {
    let long = "k".repeat(MAX_NAME_CHARS + 50);
    let nodes = outline_of(SyntaxKey::Json, &format!("{{\"{long}\": 1}}"));
    assert_eq!(nodes[0].name.chars().count(), MAX_NAME_CHARS + 1);
    assert!(nodes[0].name.ends_with('…'));
}

#[test]
fn the_symbol_list_is_capped() {
    let body: String = (0..OUTLINE_MAX_SYMBOLS + 100)
        .map(|index| format!("\"k{index}\": {index},"))
        .collect();
    let nodes = outline_of(SyntaxKey::Json, &format!("{{{}\"last\": 0}}", body));
    assert_eq!(nodes.len(), OUTLINE_MAX_SYMBOLS);
}

#[test]
fn the_name_budget_stops_the_list_early() {
    // 每个名字 200 字节，撞破 OUTLINE_MAX_NAME_BYTES 时符号数还远没到上限
    let filler = "n".repeat(200);
    let body: String = (0..OUTLINE_MAX_SYMBOLS)
        .map(|index| format!("\"{filler}{index}\": {index},"))
        .collect();
    let nodes = outline_of(SyntaxKey::Json, &format!("{{{}\"last\": 0}}", body));
    assert!(nodes.len() < OUTLINE_MAX_SYMBOLS);
    let bytes: usize = nodes.iter().map(|node| node.name.len()).sum();
    assert!(bytes <= OUTLINE_MAX_NAME_BYTES);
}

#[test]
fn a_language_without_a_query_has_no_outline_at_all() {
    // 「没有大纲」与「大纲是空的」必须能区分：前者要显示一句解释
    assert_eq!(SyntaxKey::from_file_name("server.log"), None);
}

#[test]
fn symbol_at_picks_the_innermost() {
    let nodes = outline_of(SyntaxKey::TypeScript, "class Box {\n  open() {}\n}\n");
    let inside = nodes[1].start + 1;
    assert_eq!(symbol_at(&nodes, inside), Some(1));
}

#[test]
fn symbol_at_finds_nothing_outside_every_definition() {
    let nodes = outline_of(SyntaxKey::TypeScript, "class Box {}\n// tail\n");
    let tail = nodes[0].end + 3;
    assert_eq!(symbol_at(&nodes, tail), None);
}

#[test]
fn ancestors_run_outermost_first() {
    let nodes = outline_of(SyntaxKey::TypeScript, "class Box {\n  open() {}\n}\n");
    let inside = nodes[1].start + 1;
    assert_eq!(ancestors_at(&nodes, inside), vec![0, 1]);
}

#[test]
fn ancestors_of_nothing_is_empty() {
    let nodes = outline_of(SyntaxKey::TypeScript, "class Box {}\n");
    assert!(ancestors_at(&nodes, nodes[0].end + 1).is_empty());
}

#[test]
fn siblings_stay_within_one_parent() {
    let nodes = outline_of(
        SyntaxKey::TypeScript,
        "class A {\n  one() {}\n  two() {}\n}\nclass B {\n  three() {}\n}\n",
    );
    // one / two 同属 A；B 的 three 不该混进来
    assert_eq!(siblings_of(&nodes, 1), vec![1, 2]);
    assert_eq!(siblings_of(&nodes, 2), vec![1, 2]);
    // 顶层的两个类互为同级
    assert_eq!(siblings_of(&nodes, 0), vec![0, 3]);
}

#[test]
fn siblings_of_a_missing_index_is_empty() {
    let nodes = outline_of(SyntaxKey::TypeScript, "class Box {}\n");
    assert!(siblings_of(&nodes, 9).is_empty());
}

#[test]
fn go_lists_functions_types_and_methods() {
    let nodes = outline_of(
        SyntaxKey::Go,
        "package main\n\ntype Box struct{}\n\nfunc (b Box) Open() {}\n\nfunc main() {}\n",
    );
    assert!(names(&nodes).contains(&"Box"));
    assert!(names(&nodes).contains(&"Open"));
    assert!(names(&nodes).contains(&"main"));
}

#[test]
fn yaml_lists_mapping_keys() {
    let nodes = outline_of(SyntaxKey::Yaml, "server:\n  host: localhost\nname: fak\n");
    assert_eq!(names(&nodes), vec!["server", "host", "name"]);
    assert_eq!(nodes[0].kind, SymbolKind::Key);
    // host 在 server 名下，缩进要多一层
    assert_eq!(nodes[1].depth, nodes[0].depth + 1);
    assert_eq!(nodes[2].depth, nodes[0].depth);
}

#[test]
fn toml_nests_keys_under_their_table() {
    let nodes = outline_of(SyntaxKey::Toml, "[server]\nhost = \"localhost\"\n");
    assert_eq!(names(&nodes), vec!["server", "host"]);
    assert_eq!(nodes[0].kind, SymbolKind::Module);
    assert_eq!(nodes[1].depth, nodes[0].depth + 1);
}

#[test]
fn ini_nests_settings_under_their_section() {
    let nodes = outline_of(SyntaxKey::Ini, "[core]\neditor = fak\n");
    assert_eq!(names(&nodes), vec!["core", "editor"]);
    assert_eq!(nodes[0].kind, SymbolKind::Module);
    assert_eq!(nodes[1].depth, nodes[0].depth + 1);
}

#[test]
fn xml_lists_nested_elements() {
    let nodes = outline_of(SyntaxKey::Xml, "<root>\n  <child/>\n</root>\n");
    assert_eq!(names(&nodes), vec!["root", "child"]);
    assert_eq!(nodes[1].depth, nodes[0].depth + 1);
}

#[test]
fn kotlin_lists_classes_and_functions() {
    let nodes = outline_of(
        SyntaxKey::Kotlin,
        "class Box {\n    fun open() {}\n}\n\nfun main() {}\n",
    );
    assert_eq!(names(&nodes), vec!["Box", "open", "main"]);
    assert_eq!(nodes[0].kind, SymbolKind::Class);
    assert_eq!(nodes[1].depth, nodes[0].depth + 1);
}

/// 增量拼接必须与全量重建**逐字段一致**，否则省下来的那点时间毫无意义。
fn assert_incremental_matches_full(syntax: SyntaxKey, before: &str, after: &str) {
    let cache = SyntaxCache::default();
    let previous = cache
        .with_parsed_mut("doc", syntax, before, 1, |parsed| {
            build_snapshot(&parsed.tree, &parsed.source, syntax)
        })
        .expect("首次构建不该失败")
        .expect("这门语言应当有大纲");

    let spliced = cache
        .with_parsed_mut("doc", syntax, after, 2, |parsed| {
            let edit = parsed.last_edit.expect("改过正文就该记下改动区间");
            build_after_edit(&parsed.tree, &parsed.source, syntax, &previous, &edit)
        })
        .expect("增量构建不该失败")
        .expect("这门语言应当有大纲");

    assert_eq!(spliced.nodes, outline_of(syntax, after));
}

#[test]
fn incremental_matches_full_rebuild_when_a_function_is_inserted() {
    assert_incremental_matches_full(
        SyntaxKey::TypeScript,
        "function head() {}\nfunction tail() {}\n",
        "function head() {}\nfunction middle() {}\nfunction tail() {}\n",
    );
}

#[test]
fn incremental_matches_full_rebuild_when_a_method_is_renamed() {
    assert_incremental_matches_full(
        SyntaxKey::TypeScript,
        "class Box {\n  open() {}\n}\nfunction tail() {}\n",
        "class Box {\n  unlock() {}\n}\nfunction tail() {}\n",
    );
}

#[test]
fn incremental_matches_full_rebuild_when_a_symbol_is_deleted() {
    assert_incremental_matches_full(
        SyntaxKey::TypeScript,
        "function head() {}\nfunction middle() {}\nfunction tail() {}\n",
        "function head() {}\nfunction tail() {}\n",
    );
}

// Markdown 的层级来自 capture 名而不是嵌套，拼接时必须把它一起带过去
#[test]
fn incremental_matches_full_rebuild_for_markdown_headings() {
    assert_incremental_matches_full(
        SyntaxKey::Markdown,
        "# One\n\n## Two\n\n# Three\n",
        "# One\n\n## Two\n\n## Two point five\n\n# Three\n",
    );
}

// 多字节字符要保证 UTF-16 偏移的平移量算得对
#[test]
fn incremental_matches_full_rebuild_with_multibyte_text() {
    assert_incremental_matches_full(
        SyntaxKey::TypeScript,
        "// 说明\nfunction head() {}\nfunction tail() {}\n",
        "// 说明说明\nfunction head() {}\nfunction tail() {}\n",
    );
}

#[test]
fn identical_text_reports_no_edit() {
    assert_eq!(text_edit("same", "same"), None);
}

#[test]
fn an_edit_covers_only_what_actually_changed() {
    let edit = text_edit("abcdef", "abXYdef").expect("有改动");
    assert_eq!(edit.start_byte, 2);
    assert_eq!(edit.old_end_byte, 3);
    assert_eq!(edit.new_end_byte, 4);
}
