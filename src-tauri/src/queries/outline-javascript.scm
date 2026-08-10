; 大纲查询：JavaScript / JSX（SPEC F6.1）。
;
; 比 TypeScript 那份少了接口、枚举、类型别名与抽象成员——JS 语法里没有这些节点，
; 留着会让 query 编译直接失败。

(function_declaration
  name: (_) @name) @definition.function

(generator_function_declaration
  name: (_) @name) @definition.function

(class_declaration
  name: (_) @name) @definition.class

(method_definition
  name: (_) @name) @definition.method

(variable_declarator
  name: (_) @name
  value: [(arrow_function) (function_expression)]) @definition.function
