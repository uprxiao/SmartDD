import {build} from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const repo='/Users/hx/projects/SmartDD',root=import.meta.dirname,results=[];
for(const [name,entry] of [
 ['tasks',`export {tasksStore} from '${repo}/src/renderer/core/tasks-store.ts';export {shouldAutoResume} from '${repo}/src/renderer/core/auto-resume.ts';export {when,runInAction} from 'mobx';`],
 ['voice',`export {VoiceService} from '${repo}/src/main/core/voice/voice-service.ts';export {voiceTriggerSchema} from '${repo}/src/shared/voice.ts';export {APP_SETTINGS_DEFAULTS} from '${repo}/src/shared/app-settings.ts';`]
]){
 const result=await build({absWorkingDir:repo,stdin:{contents:entry,resolveDir:repo},outfile:root+'/'+name+'.cjs',bundle:true,platform:'node',format:'cjs',metafile:true,alias:{'@shared':repo+'/src/shared'},nodePaths:['/private/tmp/willyou-m10-config-fix-9_31ogou/node_modules','/private/tmp/willyou-m14-owner-probe/node_modules'],plugins:[{name:'isolate-renderer-dependencies',setup(b){
  b.onResolve({filter:/^@renderer\/lib\/ipc$/},()=>({path:'ipc',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/terminal-size$/},()=>({path:'size',namespace:'fixture'}));
  b.onResolve({filter:/^\.\.\/features\/files\/workspace-store$/},()=>({path:'files',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{ipc:'export const rpc=globalThis.__m14UiHarness.rpc;export const events=globalThis.__m14UiHarness.events;',navigation:'export const navigation=globalThis.__m14UiHarness.navigation;',size:'export const terminalSize=()=>({cols:80,rows:24});',files:'export const prepareFileWorkspaceClose=(...args)=>globalThis.__m14UiHarness.prepare(...args);'}[args.path]}));
 }}]});
 const sources=Object.keys(result.metafile.inputs).filter(x=>x!=='<stdin>').map(path=>path.startsWith('fixture:')?{path,stub:true}:{path:resolve(repo,path),sha256:createHash('sha256').update(readFileSync(resolve(repo,path))).digest('hex')});results.push({name,entry,sources,sha256:createHash('sha256').update(readFileSync(root+'/'+name+'.cjs')).digest('hex')});
}
writeFileSync(root+'/build.json',JSON.stringify(results,null,2));
