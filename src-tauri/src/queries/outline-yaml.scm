; 大纲查询：YAML（SPEC F6.1「结构化数据」）。
;
; 只取映射键。序列项没有名字，列成一串 `[0] [1] [2]` 只是把噪音摊开——
; 与 JSON 那份是同一个取舍。层级由 `block_mapping_pair` 的范围包含关系算出。

(block_mapping_pair
  key: (_) @name) @definition.key

(flow_pair
  key: (_) @name) @definition.key
