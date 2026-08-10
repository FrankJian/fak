; 大纲查询：Kotlin（SPEC F6.1）。
;
; grammar crate 不带 `tags.scm`，这份是自己写的（Go / Java / C / C++ / C# / PHP /
; Swift 直接复用各自 crate 的 tags 查询）。

(class_declaration
  name: (identifier) @name) @definition.class

(object_declaration
  name: (identifier) @name) @definition.class

(companion_object
  name: (identifier) @name) @definition.class

(function_declaration
  name: (identifier) @name) @definition.function

(property_declaration
  (variable_declaration
    (identifier) @name)) @definition.property

(type_alias
  type: (identifier) @name) @definition.type

(enum_entry
  (identifier) @name) @definition.constant
