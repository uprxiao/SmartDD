import {build} from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import {readFileSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=import.meta.dirname,repo='/Users/hx/projects/SmartDD';
if(!existsSync(root+'/node_modules'))symlinkSync('/private/tmp/willyou-m14-owner-probe/node_modules',root+'/node_modules');
const entry=['mail-user-authorizations','native-mail-intent','mail-send-data-service'].map(n=>`export * from '${repo}/src/main/core/applications/${n}.ts';`).join('\n');
const r=await build({stdin:{contents:entry,resolveDir:repo,loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:root+'/actual.cjs',metafile:true,tsconfig:repo+'/tsconfig.node.json',external:['better-sqlite3'],nodePaths:[root+'/node_modules']});
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(root+'/build.json',JSON.stringify({note:'Unmodified MailUserAuthorizations and its runtime dependencies; no source overlay in this bundle. Native reader overlay and candidate ledger reused separately, recorded in inputs.',sources:Object.keys(r.metafile.inputs).filter(x=>!x.startsWith('<')).map(p=>({path:p,sha256:sha(p)})),bundleSha256:sha(root+'/actual.cjs'),reused:['/private/tmp/willyou-m14-input-origin-probe/actual.cjs','/private/tmp/willyou-m14-input-origin-probe/candidate.cjs','/private/tmp/willyou-m14-input-origin-probe/candidate.mjs'].map(p=>({path:p,sha256:sha(p)}))},null,2));
