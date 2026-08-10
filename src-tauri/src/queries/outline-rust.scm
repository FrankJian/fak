; 大纲查询：Rust（SPEC F6.1）。
;
; `impl` 块用它实现的类型名当标题：`impl Foo` 下面挂着 `Foo` 的方法，
; 这比显示一个匿名的「impl」条目有用得多。

(function_item
  name: (_) @name) @definition.function

(function_signature_item
  name: (_) @name) @definition.function

(struct_item
  name: (_) @name) @definition.class

(union_item
  name: (_) @name) @definition.class

(enum_item
  name: (_) @name) @definition.enum

(trait_item
  name: (_) @name) @definition.interface

(impl_item
  type: (_) @name) @definition.class

(mod_item
  name: (_) @name) @definition.module

(const_item
  name: (_) @name) @definition.constant

(static_item
  name: (_) @name) @definition.constant

(type_item
  name: (_) @name) @definition.type

(macro_definition
  name: (_) @name) @definition.function
