import {build} from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import {readFileSync,writeFileSync,globSync,existsSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
const repo='/Users/hx/projects/SmartDD',root=import.meta.dirname,owner='/private/tmp/willyou-m14-owner-probe',extra='/private/tmp/willyou-m10-config-fix-9_31ogou/node_modules';
if(!existsSync(root+'/node_modules'))symlinkSync(owner+'/node_modules',root+'/node_modules');
const common={bundle:true,platform:'node',format:'cjs',target:'node22',metafile:true,nodePaths:[owner+'/node_modules',extra],external:['better-sqlite3'],tsconfig:repo+'/tsconfig.node.json'};
const sources=new Map(),outputs=[];
function record(result,file,description){for(const source of Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('<'))){const path=source.startsWith('/')?source:process.cwd()+'/'+source;sources.set(path,{path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}outputs.push({file,description,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});}
for(const driver of ['claude','codex']){
const file=root+'/actual-'+driver+'.cjs';const modules={
'__tests__/run-fixture':['runFixture'],
'run-registry':['assertOwnedCapabilityRun'],
'process-identity':['MacProcessIdentityReader'],
'unix-peer-identity':['MacUnixPeerIdentityReader'],
'private-broker':['PrivateApplicationBroker'],
'agent-bridge-processes':['AgentBridgeProcesses'],
'tool-service':['ApplicationToolService']};
const result=await build({...common,stdin:{contents:Object.entries(modules).map(([path,names])=>`export {${names.join(',')}} from '${repo}/src/main/core/applications/${path}.ts';`).join('\n'),resolveDir:repo,loader:'ts'},outfile:file,plugins:[{name:'raw-assets-and-runner-fixture',setup(b){b.onLoad({filter:/\/(db\/migrations|capabilities\/assets)\.ts$/},({path})=>({loader:'ts',contents:readFileSync(path,'utf8').replace(/import\.meta\.glob\('([^']+)',\s*\{[\s\S]*?\}\)/g,(_,pattern)=>'('+JSON.stringify(Object.fromEntries(globSync(pattern.replace('@root/',repo+'/')).flatMap(p=>{try{return [[p,readFileSync(p,'utf8')]];}catch{return [];}})))+')')}));if(driver==='codex')b.onLoad({filter:/\/__tests__\/run-fixture\.ts$/},({path})=>({loader:'ts',contents:readFileSync(path,'utf8').replaceAll('claude-code','codex').replace("join(home,'.claude')","join(home,'.codex')")}));}}]});record(result,file,driver==='codex'?'Actual runtime modules, test fixture only substitutes claude-code->codex and .claude->.codex':'Actual runtime modules and existing test fixture; Vite raw asset loading substituted');}
const file=root+'/mcp-bridge.cjs';record(await build({...common,entryPoints:[repo+'/src/main/core/applications/bridge-runtime.ts'],outfile:file}),file,'Existing bridge-runtime.ts bundled without source substitution; isolated esbuild build, not release bundle');
writeFileSync(root+'/build.json',JSON.stringify({outputs,sources:[...sources.values()]},null,2)+'\n');console.log(JSON.stringify({outputs:outputs.map(x=>({file:x.file,description:x.description})),sourceCount:sources.size}));
