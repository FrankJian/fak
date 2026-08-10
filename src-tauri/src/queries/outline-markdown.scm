; 大纲查询：Markdown 标题（SPEC F6.1）。
;
; 层级写死在 capture 名里而不是靠嵌套算：标题在语法树上是**平铺**的，
; `##` 并不是 `#` 的子节点，按包含关系算出来的层级会全是 0。

(atx_heading
  (atx_h1_marker)
  (inline) @name) @definition.heading1

(atx_heading
  (atx_h2_marker)
  (inline) @name) @definition.heading2

(atx_heading
  (atx_h3_marker)
  (inline) @name) @definition.heading3

(atx_heading
  (atx_h4_marker)
  (inline) @name) @definition.heading4

(atx_heading
  (atx_h5_marker)
  (inline) @name) @definition.heading5

(atx_heading
  (atx_h6_marker)
  (inline) @name) @definition.heading6

; 下划线式标题（`====` / `----`）只有两级
(setext_heading
  (paragraph) @name
  (setext_h1_underline)) @definition.heading1

(setext_heading
  (paragraph) @name
  (setext_h2_underline)) @definition.heading2
