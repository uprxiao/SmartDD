import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterAll,afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { FileRoot } from '@shared/files';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { FileService } from '@main/core/files/file-service';
import type { FileFuzzyResult } from './file-fuzzy-model.mjs';
import { fuzzyRankingFixtures,verifyFuzzyFixture } from './fuzzy-ranking-fixtures.mjs';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),fixtures=fuzzyRankingFixtures(),runs:{caseId:string;status:string;scenarios:unknown[];error?:string}[]=[];
let workerInfo:unknown;
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_FUZZY_APP)('U04-U09 real native provider and original compiled ranking Worker',()=>{
 let base:string,root:string,broker:NativeFileBroker,service:FileService,lease:FileRoot,workerCode:string,started:number,terminated:number;
 beforeEach(async()=>{
  const resources=join(process.env.SMARTDD_FUZZY_APP!,'Contents/Resources'),require=createRequire(join(resources,'app.asar/package.json'));require('original-fs');const assets=join(resources,'app.asar/out/renderer/assets'),matches=readdirSync(assets).filter(name=>/^name-search\.worker-.*\.js$/.test(name));expect(matches).toHaveLength(1);const workerPath=process.env.SMARTDD_FUZZY_WORKER_SOURCE??join(assets,matches[0]);workerCode=readFileSync(workerPath,'utf8');workerInfo={path:workerPath,sha256:sha(workerCode),packaged:!process.env.SMARTDD_FUZZY_WORKER_SOURCE,transport:'Unmodified compiled worker bytes in Node worker_threads with a minimal self/parentPort bridge; actual browser Worker separately A'};
  base=mkdtempSync('/private/tmp/willyou-fuzzy-native-');root=join(base,'project');mkdirSync(root);mkdirSync(join(base,'userdata'));for(const[path,text]of Object.entries(fixtures.files)){const file=join(root,path);mkdirSync(file.slice(0,file.lastIndexOf('/')),{recursive:true});writeFileSync(file,text)}
  broker=new NativeFileBroker(join(resources,'native/willyou-files'));const resolver={sources:()=>[{kind:'project-directory'as const,id:'fuzzy',path:root,label:'Own fuzzy source',projectId:'FUZZY'}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));lease=(await service.openScope('fuzzy-owner',{kind:'project',projectId:'FUZZY'})).roots[0];started=terminated=0;
 });
 afterEach(async()=>{service.closeOwner('fuzzy-owner');await service.watcher.dispose();expect(service.searcher.activeRequests).toBe(0);expect(broker.activeProcesses).toBe(0);broker.dispose();expect(started).toBe(terminated);for(const[path,text]of Object.entries(fixtures.files))expect(readFileSync(join(root,path),'utf8')).toBe(text);rmSync(base,{recursive:true,force:true})});
 async function rank(paths:string[],query:string){
  const shim="const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:value=>parentPort.postMessage(value)};\n",worker=new Worker(shim+workerCode+"\nparentPort.on('message',data=>self.onmessage({data}));",{eval:true});started++;
  try{return await new Promise<({path:string;file_name:string}&FileFuzzyResult)[]>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Original ranking worker timeout')),5000);worker.once('error',error=>{clearTimeout(timer);reject(error)});worker.once('message',value=>{clearTimeout(timer);value.error?reject(Error(value.error)):resolve(value.ranked)});worker.postMessage({paths,query})})}finally{await worker.terminate();terminated++}
 }
 it.each(['M9-T-U04','M9-T-U05','M9-T-U06','M9-T-U07','M9-T-U08','M9-T-U09'])('%s real walk candidates retain ranking, fragments and stable membership',async caseId=>{
  const row={caseId,status:'running',scenarios:[]as unknown[],error:undefined as string|undefined};runs.push(row);
  try{for(const scenario of fixtures.cases.filter(x=>x.caseId===caseId)){
   const result=await service.searcher.search('fuzzy-owner',{id:randomUUID(),root:{lease:lease.lease,generation:lease.generation},kind:'name',query:scenario.query,mask:''},()=>undefined),ranked=await rank(result.paths,scenario.query),record={id:scenario.id,query:scenario.query,nativePaths:result.paths,nativePathsHash:sha(JSON.stringify(result.paths)),ranked,workerStarted:started,workerTerminated:terminated};row.scenarios.push(record);verifyFuzzyFixture(scenario,ranked,result.paths);expect(service.searcher.activeRequests).toBe(0);
  }row.status='passed'}catch(error){row.status='failed';row.error=String(error);throw error}
 });
});
afterAll(()=>{if(process.env.SMARTDD_FUZZY_EVIDENCE)writeFileSync(process.env.SMARTDD_FUZZY_EVIDENCE,JSON.stringify({at:new Date().toISOString(),app:process.env.SMARTDD_FUZZY_APP,worker:workerInfo,runs},null,2)+'\n')});
