import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('../../src/shared', import.meta.url)) }, dedupe: ['@codemirror/state','@codemirror/view','@codemirror/commands','react','react-dom'] },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    entries: ['index.html', 'tests/math-selection-runtime.html', 'tests/markdown-events-runtime.html', 'tests/inline-diff-runtime.html'],
    include: ["react", "react-dom/client", '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/merge', 'katex', 'markdown-it', 'js-yaml', 'shiki/core', 'shiki/engine/javascript'],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../src/shared', import.meta.url)), fileURLToPath(new URL('../../scripts/files/inline-diff-fixtures.mjs', import.meta.url)), ...['tree-path-tooltip.tsx','markdown','code','editor-source.ts','text-find-state.ts','text-find.ts','conflict-diff.ts','source-view.tsx','source-view.css','office/workbook-vector.tsx','office/workbook-chart-svg.tsx'].map(path=>fileURLToPath(new URL('../../src/renderer/features/files/'+path,import.meta.url))), realpathSync(fileURLToPath(new URL('../../node_modules/katex/dist/fonts', import.meta.url)))] },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
    // M13 P0.12（用户 2026-11-11 要求）：SMG 供应商在原型中真实接入。浏览器直连局域网网关会被跨域拦截，
    // 由开发服务器只转发到这一个地址；Key 由用户在页面里填写，只随请求头转发，不写入任何文件。
    // 内网地址不入库（用户 2026-11-11 决定）：启动时用环境变量 M13_SMG_URL 指定，例如 M13_SMG_URL=http://<SMG 内网地址> npx vite …
    proxy: process.env.M13_SMG_URL ? {
      '/__m13-live/smg': { target: process.env.M13_SMG_URL, changeOrigin: true, rewrite: path => path.replace(/^\/__m13-live\/smg/, '') },
    } : {},
  },
  define: { __M13_SMG_URL__: JSON.stringify(process.env.M13_SMG_URL || '') },
  plugins: [react()],
});
