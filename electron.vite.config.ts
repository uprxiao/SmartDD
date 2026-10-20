import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const alias = {
  '@root': resolve('.'),
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer'),
};
const copyPdfAssets = () => {
  const target = resolve('out/renderer/pdf-assets');
  mkdirSync(target, { recursive: true });
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) cpSync(resolve('node_modules/pdfjs-dist', folder), resolve(target, folder), { recursive: true });
  cpSync(resolve('node_modules/pdfjs-dist/LICENSE'), resolve(target, 'LICENSE-pdfjs-dist'));
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), { name: 'smartdd-native-bridges', writeBundle() {
      execFileSync(process.execPath, ['scripts/voice/build.mjs'], { stdio: 'inherit' });
      execFileSync(process.execPath, ['scripts/files/build.mjs'], { stdio: 'inherit' });
      execFileSync(process.execPath, ['scripts/applications/build.mjs'], { stdio: 'inherit' });
      if (process.platform === 'darwin') {
        execFileSync('python3', ['scripts/files/prepare-tex.py'], { stdio: 'inherit' });
        execFileSync('python3', ['scripts/files/prepare-office.py'], { stdio: 'inherit' });
        execFileSync('python3', ['scripts/files/prepare-libreoffice.py'], { stdio: 'inherit' });
      }
    } }],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'm9-html-resources': resolve('src/main/core/files/html/worker.ts'), 'm9-tex-resources': resolve('src/main/core/files/tex/worker.ts'), 'm9-office-document': resolve('src/main/core/files/office/worker.ts'), 'm9-office-pages': resolve('src/main/core/files/office/pages-worker.ts'), 'm9-pptx-document': resolve('src/main/core/files/office/pptx-worker.ts'), 'm10-mail-reader': resolve('src/main/core/applications/providers/mail-worker.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), 'm9-html-guard': resolve('src/preload/m9-html-guard.ts'), 'm9-mcp-ui': resolve('src/preload/m9-mcp-ui.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss(), { name: 'willyou-pdf-offline-assets', configureServer: copyPdfAssets, closeBundle: copyPdfAssets }],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html'), 'm9-diagram': resolve('src/renderer/m9-diagram.html') } } },
  },
});
