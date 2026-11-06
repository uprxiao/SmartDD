import{defineConfig}from'vitest/config';import{resolve}from'node:path';
const root='/private/tmp/willyou-m12-t015-U-closeout-003';
export default defineConfig({root,cacheDir:root+'/cache/vite',esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom'],alias:{'@shared':resolve(root,'src/shared'),'@renderer':resolve(root,'src/renderer')}},test:{include:['src/main/core/browser/__tests__/downloads.test.ts','src/renderer/features/browser/download-panel.test.tsx'],environment:'node',pool:'threads',maxWorkers:1,fileParallelism:false,watch:false}});
