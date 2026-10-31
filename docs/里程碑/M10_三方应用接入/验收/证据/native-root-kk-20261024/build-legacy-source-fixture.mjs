// Build a fixture helper only. Production package inputs/outputs stay untouched.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'vite';
const root=await mkdtemp('/private/tmp/willyou-m10-legacy-source-helper-');
await build({configFile:false,logLevel:'warn',resolve:{alias:{'@root':resolve('.'),'@shared':resolve('src/shared'),'@main':resolve('src/main')}},build:{ssr:resolve('scripts/applications/fixtures/legacy-native-source.ts'),outDir:root,emptyOutDir:false,minify:false,rollupOptions:{output:{format:'cjs',entryFileNames:'legacy-source.cjs'}}}});
const path=join(root,'legacy-source.cjs'),bytes=await readFile(path);assert(bytes.length>10000);
const result={path,sha256:createHash('sha256').update(bytes).digest('hex'),boundary:'Production legacy source/retention library fixture; no App binary modification; real process identity and owned cleanup; cipher use forbidden'};
await writeFile(join(root,'manifest.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
