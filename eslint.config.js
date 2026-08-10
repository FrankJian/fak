import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const lucidePattern = {
  group: ['lucide-react', 'lucide-react/*'],
  message: '图标必须从 src/design/iconRegistry.ts 按语义取用（AGENTS.md §5.4）',
};

const tauriPattern = {
  group: ['@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/plugin-*'],
  message: '组件不得直接 invoke，统一经 src/ipc 封装层（AGENTS.md §5.2）',
};

const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      'no-console': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: restrict(lucidePattern, tauriPattern),
  },
  {
    // 注册表是全应用唯一允许 import lucide 的地方；lucide.d.ts 只是深路径的类型声明
    files: ['src/design/iconRegistry.ts', 'src/lucide.d.ts'],
    rules: restrict(tauriPattern),
  },
  {
    // IPC 封装层是唯一允许直接触碰 Tauri API 的地方
    files: ['src/ipc/**/*.{ts,tsx}'],
    rules: restrict(lucidePattern),
  },
  {
    files: ['src/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{ts,js,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
