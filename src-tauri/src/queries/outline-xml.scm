; 大纲查询：XML（SPEC F6.1「结构化数据」）。
;
; 取标签名，层级由元素嵌套的范围包含关系算出。自闭合标签同样列出——
; 它在文档结构里和成对标签一样是一个节点，漏掉会让大纲与正文对不上。

(element
  (STag
    (Name) @name)) @definition.key

(element
  (EmptyElemTag
    (Name) @name)) @definition.key
