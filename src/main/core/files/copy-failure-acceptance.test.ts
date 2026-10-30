import {createHash} from 'node:crypto';
import {chmod,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createSaveFailureFixture} from '../../../../scripts/files/text-save-failure-fixture.mjs';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const body=Buffer.from('E09 owned readonly source 中文🙂\r\n'+'large original line 中文🙂\r\n'.repeat(2048));
const marker=Buffer.from('Existing destination must survive\r\n');
const rows:unknown[]=[];
let environment:Awaited<ReturnType<typeof createSaveFailureFixture>>,service:FileService,broker:NativeFileBroker,source:string,ref:Awaited<ReturnType<FileService['open']>>;
const disk=async(path:string)=>{const s=await stat(path,{bigint:true});return{hash:sha(await readFile(path)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),bytes:String(s.size)}};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('E09 original native copy failure boundaries',()=>{
 beforeAll(async()=>{
  environment=await createSaveFailureFixture(process.env.SMARTDD_M9_FILE_BROKER!,{faultOperations:['copy']});const root=join(environment.base,'source'),userdata=join(environment.base,'userdata');await mkdir(root);await mkdir(userdata);source=join(root,'readonly.txt');await writeFile(source,body);await chmod(source,0o444);
  broker=new NativeFileBroker(environment.wrapper);const resolver={sources:()=>[{kind:'project-directory' as const,id:'copy-source',projectId:'E09',label:'E09 own source outside full volume',path:root}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));const scope=(await service.openScope('E09',{kind:'project',projectId:'E09'})).roots[0];ref=await service.open('E09',{lease:scope.lease,generation:scope.generation,relativePath:'readonly.txt'});expect(ref.writable).toBe(false);
 },60000);
 it.each(['permission','disk-full','generic']as const)('retains source/destination on real %s and permits an explicit new copy after recovery',async mode=>{
  await environment.clear();const destination=join(environment.project,mode+'.txt');await writeFile(destination,marker);const sourceBefore=await disk(source),targetBefore=await disk(destination),selection=await service.actions.prepareCopy('E09',{target:{kind:'document',ref:ref.ref}});const fault=await environment.activate(mode);
  try{
   let message='';try{await service.actions.copyTo('E09',selection,destination)}catch(error){message=String(error)}expect(message).toMatch(mode==='permission'?/denied|permission/i:mode==='disk-full'?/space/i:/File too large/i);expect(await disk(source)).toEqual(sourceBefore);expect(await disk(destination)).toEqual(targetBefore);
   await environment.clear();const again=await service.actions.prepareCopy('E09',{target:{kind:'document',ref:ref.ref}}),retry=join(environment.project,mode+'-recovered.txt'),receipt=await service.actions.copyTo('E09',again,retry);expect(receipt.state).toBe('saved');expect(await readFile(retry)).toEqual(body);expect(await disk(source)).toEqual(sourceBefore);expect(await disk(destination)).toEqual(targetBefore);
   rows.push({mode,fault,error:message,sourceBefore,targetBefore,retryHash:sha(await readFile(retry)),receipt,originalNative:true});
  }finally{await environment.clear()}
 },30000);
 afterAll(async()=>{if(service){service.closeOwner('E09');await service.watcher.dispose()}broker?.dispose();if(environment){await environment.clear();const native=await environment.observations();await environment.close();if(process.env.SMARTDD_E09_EVIDENCE)await writeFile(process.env.SMARTDD_E09_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'I actual native/FileService',rows,native,environment:environment.evidence,boundary:'Own64MiB APFS only,real chmod/ENOSPC/RLIMIT_FSIZE(copy). Original broker/request/response;no fabricated copy/error. Source and recovery off full volume. No system save picker or UI claim.'},null,2)+'\n')}},60000);
});
