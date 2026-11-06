// Isolated serving/cache paths only; approved prototype source and design intact.
import original from './reference/source/prototypes/m6-codex/vite.config.mjs';
const root='/private/tmp/willyou-m12-t145-visual-matrix-prep-001';
export default {...original,cacheDir:root+'/cache/vite-attempt-003',optimizeDeps:{...original.optimizeDeps,include:[...(original.optimizeDeps?.include??[]),'docx-preview','docx-preview > jszip']},server:{...original.server,host:'127.0.0.1',fs:{allow:[root+'/reference/source',root+'/deps/packages']}}};
