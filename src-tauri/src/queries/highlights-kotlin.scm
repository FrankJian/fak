; 语法高亮：Kotlin（SPEC §6.3.5 的五色相集合）。
;
; `tree-sitter-kotlin-ng` 不随包分发 `highlights.scm`，只能自己写一份。
; 刻意只覆盖关键字 / 字符串 / 数字 / 注释 / 类型五类——§6.3.5 要求普通标识符
; 不着色，多写的 capture 到 `normalize_capture` 那一步也会被丢掉。

[
  "abstract" "actual" "annotation" "as" "by" "catch" "class" "companion"
  "const" "constructor" "crossinline" "data" "do" "dynamic" "else" "enum"
  "expect" "external" "final" "finally" "for" "fun" "get" "if" "import"
  "in" "infix" "init" "inline" "inner" "interface" "internal" "is"
  "lateinit" "noinline" "object" "open" "operator" "out" "override"
  "package" "private" "protected" "public" "return" "sealed"
  "set" "super" "suspend" "tailrec" "this" "throw" "try" "typealias"
  "val" "value" "var" "vararg" "when" "where" "while"
] @keyword

(line_comment) @comment
(block_comment) @comment
(shebang) @comment

(string_literal) @string
(multiline_string_literal) @string
(character_literal) @string
(escape_sequence) @string

(number_literal) @number
(float_literal) @number

(user_type) @type
