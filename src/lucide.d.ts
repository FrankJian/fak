// lucide 不为深路径导出提供类型声明，strict 下会报隐式 any（AGENTS.md §5.4）
declare module 'lucide-react/icons/*' {
  import type { LucideProps } from 'lucide-react';
  import type { FC } from 'react';
  const Icon: FC<LucideProps>;
  export default Icon;
}
