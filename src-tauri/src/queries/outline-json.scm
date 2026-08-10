; 大纲查询：JSON（SPEC F6.1「结构化数据」）。
;
; 每个键一条，层级由对象嵌套算出。数组元素不进大纲：它们没有名字，
; 列成一串 `[0] [1] [2]` 只是把噪音摊开。

(pair
  key: (string) @name) @definition.key
