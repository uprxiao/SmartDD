import {build} from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='/private/tmp/willyou-m14-output-probe';const results=[];
for(const [name,entry,other] of [
['t3-budget','/Users/hx/projects/t3code/apps/server/src/orchestration-v2/LiveStreamBudget.ts',{external:['effect/*']}],
['actual-private','/Users/hx/projects/SmartDD/src/main/core/applications/codex-private-server.ts',{tsconfig:'/Users/hx/projects/SmartDD/tsconfig.node.json',nodePaths:['/private/tmp/willyou-m14-owner-probe/node_modules','/private/tmp/willyou-m14-output-probe/node_modules']}]
]) {
 const r=await build({entryPoints:[entry],bundle:true,platform:'node',format:name==='actual-private'?'cjs':'esm',outfile:root+'/'+name+(name==='actual-private'?'.cjs':'.mjs'),metafile:true,...other});
 results.push({name,sources:Object.keys(r.metafile.inputs).map(p=>({path:p,sha256:createHash('sha256').update(readFileSync(p)).digest('hex')}))});
}
writeFileSync(root+'/build.json',JSON.stringify(results,null,2));
