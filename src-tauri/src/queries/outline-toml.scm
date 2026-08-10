; 大纲查询：TOML（SPEC F6.1「结构化数据」）。
;
; 表头是天然的层级：`[a.b]` 这个节点的范围一直包到下一个表头之前，
; 它下面的键因此自动缩进一层，不必在查询里另写嵌套规则。

(table
  [(bare_key) (dotted_key) (quoted_key)] @name) @definition.module

(table_array_element
  [(bare_key) (dotted_key) (quoted_key)] @name) @definition.module

(pair
  [(bare_key) (dotted_key) (quoted_key)] @name) @definition.key
