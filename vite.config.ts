import { defineConfig } from 'vite';

// GitHub Pages 把站点放在 /<仓库名>/ 子路径下；CI 通过 VITE_BASE 传入该路径。
// 本地开发与其他静态托管保持相对路径，放在任意目录都能加载资源。
const base = process.env.VITE_BASE || './';

export default defineConfig({
  base,
  server: { port: 5173, host: true, allowedHosts: true },
  preview: { port: 4173, host: true, allowedHosts: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
