; 大纲查询：TypeScript / TSX（SPEC F6.1）。
;
; 约定：`@name` 是显示用的名字节点，`@definition.<kind>` 是整个定义节点。
; 定义节点的字节范围决定嵌套层级——方法落在类的范围内，就自动缩进一层。
;
; 名字一律写成 `(_)`：同一个字段在 JS 与 TS 语法里的节点类型不同
; （`identifier` vs `type_identifier`），写死会让一半的定义查不出来。

(function_declaration
  name: (_) @name) @definition.function

(generator_function_declaration
  name: (_) @name) @definition.function

(class_declaration
  name: (_) @name) @definition.class

(abstract_class_declaration
  name: (_) @name) @definition.class

(method_definition
  name: (_) @name) @definition.method

(abstract_method_signature
  name: (_) @name) @definition.method

(interface_declaration
  name: (_) @name) @definition.interface

(enum_declaration
  name: (_) @name) @definition.enum

(type_alias_declaration
  name: (_) @name) @definition.type

(module
  name: (_) @name) @definition.module

; 只收下箭头函数与函数表达式形式的顶层常量。把所有 `const` 都收进来的话，
; 一个配置文件的大纲会比正文还长
(variable_declarator
  name: (_) @name
  value: [(arrow_function) (function_expression)]) @definition.function
