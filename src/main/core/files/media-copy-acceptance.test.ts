import {createHash,randomUUID} from 'node:crypto';
import {chmod,mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,describe,expect,it} from 'vitest';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
const sha=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex'),rows:unknown[]=[];
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER||!process.env.SMARTDD_T31_MEDIA)('T31 actual media bytes and native save-copy integration',()=>{
 it('keeps a readonly video grant valid through successful copy,actual permission error and explicit recovered copy',async()=>{
  const source=await readFile(process.env.SMARTDD_T31_MEDIA!),base=mkdtempSync('/private/tmp/willyou-media-copy-I-'),root=join(base,'project'),dest=join(base,'destination'),userdata=join(base,'userdata');for(const p of[root,dest,userdata])await mkdir(p);const path=join(root,'video.mp4'),target=join(dest,'video-copy.mp4');await writeFile(path,source);await chmod(path,0o444);
  const broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!),resolver={sources:()=>[{kind:'project-directory'as const,id:'root',projectId:'T31',path:root,label:'T31 owned video'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver));const disk=async(p:string)=>{const s=await stat(p,{bigint:true});return{hash:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs)}};
  try{
   const before=await disk(path),scope=(await service.openScope('T31',{kind:'project',projectId:'T31'})).roots[0],file=await service.open('T31',{lease:scope.lease,generation:scope.generation,relativePath:'video.mp4'}),id=randomUUID();expect(file.writable).toBe(false);const grant=await service.media.open('T31',{id,ref:file.ref,baseHash:file.revision.hash});expect(grant).toMatchObject({mime:'video/mp4',hash:sha(source)});
   const copy=await service.actions.prepareCopy('T31',{target:{kind:'document',ref:file.ref}}),saved=await service.actions.copyTo('T31',copy,target);expect(saved.state).toBe('saved');expect(await readFile(target)).toEqual(source);
   const denied=join(dest,'denied.mp4'),marker=Buffer.from('DO NOT CHANGE');await writeFile(denied,marker);const targetBefore=await disk(denied),selection=await service.actions.prepareCopy('T31',{target:{kind:'document',ref:file.ref}});await chmod(dest,0o500);let error='';try{await service.actions.copyTo('T31',selection,denied)}catch(e){error=String(e)}expect(error).toMatch(/permission|denied/i);expect(await disk(path)).toEqual(before);expect(await disk(denied)).toEqual(targetBefore);expect(Buffer.from(await service.media.chunk('T31',id,0,Math.min(source.length,1024)),'base64')).toEqual(source.subarray(0,1024));
   await chmod(dest,0o700);const recovered=await service.actions.prepareCopy('T31',{target:{kind:'document',ref:file.ref}}),recoveredPath=join(dest,'recovered.mp4');expect((await service.actions.copyTo('T31',recovered,recoveredPath)).state).toBe('saved');expect(await readFile(recoveredPath)).toEqual(source);expect(await disk(path)).toEqual(before);service.media.release('T31',id);expect(service.media.resourceCounts).toEqual({grants:0,tokens:0,readers:0});rows.push({base,source:before,sourceBytes:source.length,grant,saved,error,targetBefore,recoveredHash:sha(await readFile(recoveredPath)),resourcesReleased:true});
  }finally{await chmod(dest,0o700);service.closeOwner('T31');await service.watcher.dispose();broker.dispose()}
 },30000);
});
afterAll(async()=>{if(process.env.SMARTDD_T31_EVIDENCE)await writeFile(process.env.SMARTDD_T31_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'I original native/media provider/copy',rows,boundary:'Own readonly video/real chmod permission/native copy. No decoder or OS picker/clipboard claim;A proves decoding and actual menu.'},null,2)+'\n')});
