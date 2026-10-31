// I-layer supplement: original packaged RPC/provider, approved real Bug refs.
// Binary resources stay in the owned host/driver memory; only hashes are saved.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {openElectron} from '../lib/electron-harness.mjs';
const executable=process.env.WILLYOU_ACCEPTANCE_APP,pin=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA,uiRoot=process.env.WILLYOU_ZENTAO_VERIFIED_UI_ROOT;
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&/^[a-f0-9]{64}$/.test(pin??''));assert(/^\/private\/tmp\/willyou-m10-zentao-live-[A-Za-z0-9]+$/.test(uiRoot??''));
const ui=JSON.parse(await readFile(join(uiRoot,'result.json'),'utf8'));assert.equal(ui.status,'passed-live-readonly-subset');assert.equal(ui.sessions.at(-1)?.exit?.code,0);
const userData=ui.userData,projectId=ui.projectId,root=await mkdtemp('/private/tmp/willyou-m10-bug-resources-'),sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(await readFile(join(dirname(dirname(executable)),'Resources/app.asar'))),pin);
const result={schema:'m10-real-bug-resource-rpc-v1',root,userData,projectId,app:executable,asar:pin,startedAt:new Date().toISOString(),layer:'I original packaged RPC/controller/provider;UI source references from verified real UI;not GUI resource controls or Agent/model acceptance',boundary:'Only approved three Bug objects;no Story,no model,binary bytes never exported,no writes or synthetic provider',driverSha256:sha(await readFile(new URL(import.meta.url))),checks:[],status:'running'};
await writeFile(join(root,'driver-executed.mjs'),await readFile(new URL(import.meta.url)),{mode:0o600});let app;
const save=()=>writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
async function check(name,detail={}){result.checks.push({name,...detail,at:new Date().toISOString()});await save();console.log(JSON.stringify({root,check:name}));}
const unwrap=r=>{assert(r.ok,'Original read failed: '+r.code);return r.value;};
async function network(){return app.mainEvaluate('({calls:globalThis.__m10BugResources.network,forbidden:globalThis.__m10BugResources.forbidden})');}
async function readAll(ref,length){const parts=[];let offset=0,chunks=0;while(true){assert(chunks++<64);const v=unwrap(await app.invoke('applications.zentaoResource',projectId,{resource:ref,offset,length})),bytes=Buffer.from(v.data,v.encoding==='base64'?'base64':'utf8');assert.equal(v.offset,offset);assert.equal(bytes.length,v.length);assert.equal(v.revision,ref.revision);parts.push(bytes);offset+=bytes.length;if(v.eof){assert.equal(v.nextOffset,null);break;}assert.equal(v.nextOffset,offset);assert(bytes.length>0);}const bytes=Buffer.concat(parts);assert.equal(bytes.length,ref.size);assert.equal(sha(bytes),ref.revision);return{bytes,chunks};}
try{
 for(const name of Object.keys(process.env))if(!['PATH','TMPDIR','LANG','LC_ALL'].includes(name))delete process.env[name];
 app=await openElectron({executable,userData,inspectMain:true,env:{HOME:homedir(),ZDOTDIR:'/private/tmp/willyou-m10-codex-live-jbchcyys/home',CODEX_HOME:'/private/tmp/willyou-m10-codex-live-jbchcyys/codex',HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',NO_PROXY:'192.168.106.185,localhost,127.0.0.1'}});result.appPid=app.processId;
 await app.evaluate("document.title='A · M10 Bug资源只读探针（接口层）';true");
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Owned data required');const g={network:[],forbidden:[],originals:[],methods:[]},map=E.ipcMain._invokeHandlers;for(const key of ['tasks.create','tasks.open','applications.prepareSend','applications.authorizeSend','applications.executeSend']){const fn=map.get(key);if(!fn)continue;g.originals.push([key,fn]);map.set(key,()=>{g.forbidden.push(key);throw Error('No Agent/write allowed in this resource probe')});}for(const name of ['http','https']){const m=process.getBuiltinModule(name),fn=m.request;g.methods.push([m,fn]);m.request=function(...args){let url;try{url=new URL(String(args[0]))}catch{return fn.apply(this,args);}if(url.origin==='http://192.168.106.185'){const row={path:url.pathname,method:args[1]?.method??'GET'};g.network.push(row);if(url.pathname.endsWith('/bugs/1')){g.forbidden.push('unapproved-object-network-attempt');throw Error('Probe refuses unapproved object transport');}}return fn.apply(this,args);};}g.restore=()=>{for(const[k,v]of g.originals)map.set(k,v);for(const[m,v]of g.methods)m.request=v;return{network:g.network,forbidden:g.forbidden,restored:g.originals.every(([k,v])=>map.get(k)===v)&&g.methods.every(([m,v])=>m.request===v)}};globalThis.__m10BugResources=g;return true})()`);
 const reference=ui['initial-bug-79291'].detail.reference,before=(await network()).calls.length;
 for(const [name,bad]of [['unlisted-id',{...reference,nativeId:'1'}],['wrong-identity',{...reference,identityRevision:reference.identityRevision+1}],['wrong-revision',{...reference,contentRevision:'0'.repeat(64)}]]){const r=await app.invoke('applications.zentaoObject',projectId,{kind:'bug',reference:bad});assert(!r.ok);assert.equal(r.code,'NOT_FOUND');await check('Unknown or altered source reference rejected before HTTP',{kind:name,code:r.code});}
 assert.equal((await network()).calls.length,before);await check('Three negative references made zero provider requests');
 for(const id of ['79064','79291','79967']){
  const v=unwrap(await app.invoke('applications.zentaoObject',projectId,{kind:'bug',reference:ui['initial-bug-'+id].detail.reference}));assert.equal(v.id,id);assert(v.complete&&v.missing.length===0);
  const assets=[];
  for(const [part,ref]of [['body',v.body],['history',v.history],...v.attachments.map((x,i)=>['attachment-'+i,x.resource])]){
   assert(ref);const value=await readAll(ref,id==='79291'&&part==='history'?512:262144);let png=false,jpeg=false,inlineImageMarkers=null;
   if(part==='body'){const text=value.bytes.toString('utf8');inlineImageMarkers=(text.match(/<img\b/gi)??[]).length;}
   if(part.startsWith('attachment')){png=value.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));jpeg=value.bytes[0]===255&&value.bytes[1]===216;}
   assets.push({part,size:ref.size,sha256:ref.revision,chunks:value.chunks,png,jpeg,inlineImageMarkers});await check('Original Bug resource fully read and hash verified',{id,...assets.at(-1)});
  }
  const retry=unwrap(await app.invoke('applications.zentaoObject',projectId,{kind:'bug',reference:v.reference}));assert.deepEqual(retry.reference,v.reference);assert.deepEqual(retry.body,v.body);assert.deepEqual(retry.history,v.history);assert.deepEqual(retry.attachments,v.attachments);await check('Repeated refresh retains source and resource identities',{id});
  const count=(await network()).calls.length,bad=await app.invoke('applications.zentaoResource',projectId,{resource:{...v.body,revision:'f'.repeat(64)},offset:0,length:1});assert(!bad.ok&&bad.code==='HASH_MISMATCH');assert.equal((await network()).calls.length,count);await check('Forged resource revision rejected before provider read',{id,code:bad.code});
 }
 const observed=await network();assert(observed.calls.length>0,'HTTP observer must prove it sees positive reads');assert.deepEqual(observed.forbidden,[]);assert.deepEqual(app.rendererErrors,[]);result.status='passed-real-bug-resource-subset';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{if(app){try{result.observer=await app.mainEvaluate('globalThis.__m10BugResources?.restore?.()??{installed:false,network:[],forbidden:[]}');if(result.observer.installed!==false){assert(result.observer.restored);assert.deepEqual(result.observer.forbidden,[]);}await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");result.appExit=await app.waitForExit(15000);}catch(error){result.cleanupError=String(error);}await app.close();}result.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({root,status:result.status,error:result.error,checks:result.checks.length}));}
