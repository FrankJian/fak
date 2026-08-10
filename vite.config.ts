import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      // lucide 的桶文件在 dev 下会拉入 1600+ 模块（AGENTS.md §5.4）
      'lucide-react/icons': fileURLToPath(
        new URL('./node_modules/lucide-react/dist/esm/icons', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          framework: ['react', 'react-dom'],
          editor: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/search',
            '@codemirror/language',
            '@codemirror/autocomplete',
          ],
        },
      },
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
