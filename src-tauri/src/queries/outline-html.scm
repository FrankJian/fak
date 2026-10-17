; HTML 元素层级由元素节点的包含关系计算，与 XML 大纲保持一致。

(element
  (start_tag
    (tag_name) @name)) @definition.key

(element
  (self_closing_tag
    (tag_name) @name)) @definition.key
