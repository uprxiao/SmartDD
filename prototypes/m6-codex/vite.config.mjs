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
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../../src/shared', import.meta.url)), fileURLToPath(new URL('../../scripts/files/inline-diff-fixtures.mjs', import.meta.url)), ...['markdown','code','editor-source.ts','text-find-state.ts','text-find.ts','conflict-diff.ts','source-view.tsx','source-view.css'].map(path=>fileURLToPath(new URL('../../src/renderer/features/files/'+path,import.meta.url))), realpathSync(fileURLToPath(new URL('../../node_modules/katex/dist/fonts', import.meta.url)))] },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
