; 大纲查询：Python（SPEC F6.1）。
;
; 类里的 `def` 与模块级的 `def` 在语法上是同一个节点，层级靠字节范围包含关系
; 算出来，不必在查询里区分。

(function_definition
  name: (_) @name) @definition.function

(class_definition
  name: (_) @name) @definition.class

(decorated_definition
  definition: (function_definition
    name: (_) @name)) @definition.function
