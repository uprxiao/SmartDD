import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterAll,describe,expect,it,vi} from 'vitest';
import {FileService} from '../file-service';
import {FileRootsService} from '../roots';
import {FileRecoveryStore} from '../recovery-store';
import {NativeFileBroker} from '../native-broker';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const native=process.env.SMARTDD_M9_FILE_BROKER,worker=process.env.SMARTDD_W14_WORKER,rows:unknown[]=[];
const inspect=(path:string)=>JSON.parse(execFileSync('python3',['scripts/files/pptx-element-menu-fixtures.py','inspect',path],{encoding:'utf8'})) as {sha256:string;names:string[];parts:Record<string,string>;drawingHashes:Record<string,string>;objects:Array<{id:string;text:string}>};
async function setup(readonly=false){
  const base=mkdtempSync('/private/tmp/willyou-pptx-shortcuts-elements-I-'),project=join(base,'project');mkdirSync(join(base,'userdata'));execFileSync('python3',['scripts/files/pptx-element-menu-fixtures.py',project]);
  const broker=new NativeFileBroker(native!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'layers',path:project,label:'I actual OOXML layers'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver),undefined,undefined,undefined,undefined,undefined,undefined,undefined,worker);
  const owner='layers',root=(await files.openScope(owner,{kind:'project',projectId:'layers'})).roots[0],relativePath=readonly?'light-readonly.pptx':'light-editable.pptx',path=join(project,relativePath),file=await files.open(owner,{lease:root.lease,generation:root.generation,relativePath}),id=randomUUID(),opened=await files.pptx.open(owner,{id,ref:file.ref,baseHash:file.revision.hash});
  return{base,path,owner,file,id,files,broker,opened,root,relativePath,close:async()=>{files.closeOwner(owner);await files.watcher.dispose();broker.dispose();}};
}
describe.skipIf(!native||!worker||process.platform!=='darwin')('W14 original Worker/FileService/native layer integration (no layout or GUI)',()=>{
  it('persists all four layer actions while preserving each drawing byte, ZIP order and untouched parts',async()=>{
    const f=await setup(),before=inspect(f.path);let state=f.opened.state;const steps=[];
    try{
      for(const[direction,order]of [['front',['201','203','204','202']],['back',['202','201','203','204']],['forward',['201','202','203','204']],['backward',['202','201','203','204']]] as const){
        state=await f.files.pptx.edit(f.owner,{id:f.id,version:state.version,action:{type:'element-layer',slideId:state.info.slides[0].id,elementId:'202',direction}});
        expect(state.info.slides[0].elements!.map(e=>e.id)).toEqual(order);
        const saved=await f.files.pptx.save(f.owner,{id:f.id,version:state.version,draftId:randomUUID(),bufferVersion:state.version,opId:randomUUID()});expect(saved.receipt.state).toBe('saved');state=saved.state;
        const disk=inspect(f.path);expect(disk.objects.map(e=>e.id)).toEqual(order);expect(disk.names).toEqual(before.names);expect(disk.drawingHashes).toEqual(before.drawingHashes);
        for(const[part,hash]of Object.entries(before.parts))if(part!=='ppt/slides/slide1.xml')expect(disk.parts[part],part).toBe(hash);
        steps.push({direction,version:state.version,order,disk});
      }
      f.files.pptx.close(f.owner,f.id);f.files.closeDocument(f.owner,f.file.ref);
      const doc=await f.files.open(f.owner,{lease:f.root.lease,generation:f.root.generation,relativePath:f.relativePath}),reopened=await f.files.pptx.open(f.owner,{id:randomUUID(),ref:doc.ref,baseHash:doc.revision.hash});expect(reopened.state.info.slides[0].elements!.map(e=>e.id)).toEqual(['202','201','203','204']);
      rows.push({scenario:'four real saves/reopen',base:f.base,before,steps,reopened:true,pass:true});
    }finally{await f.close();}
  },20000);
  it('rejects a real unsupported field text change without changing source/model, then permits a supported layer action',async()=>{
    const f=await setup(),before=inspect(f.path),slideId=f.opened.state.info.slides[0].id;
    try{
      await expect(f.files.pptx.edit(f.owner,{id:f.id,version:0,action:{type:'element-text',slideId,elementId:'204',text:'FIELD_DRAFT_MUST_NOT_COMMIT'}})).rejects.toThrow('包含域');expect(inspect(f.path)).toEqual(before);
      const state=await f.files.pptx.edit(f.owner,{id:f.id,version:0,action:{type:'element-layer',slideId,elementId:'202',direction:'front'}});expect(state.version).toBe(1);expect(inspect(f.path)).toEqual(before);rows.push({scenario:'original field rejection/model remains version0 until valid action',base:f.base,sourceUnchanged:true,fieldText:state.info.slides[0].elements!.find(e=>e.id==='204')!.text,pass:true});
    }finally{await f.close();}
  },20000);
  it('rejects layer changes to a genuinely mode0444 source',async()=>{
    const f=await setup(true),before=inspect(f.path);
    try{expect(f.file.writable).toBe(false);await expect(f.files.pptx.edit(f.owner,{id:f.id,version:0,action:{type:'element-layer',slideId:f.opened.state.info.slides[0].id,elementId:'202',direction:'front'}})).rejects.toMatchObject({code:'PERMISSION'});expect(inspect(f.path)).toEqual(before);rows.push({scenario:'real0444 source',base:f.base,sourceUnchanged:true,pass:true});}finally{await f.close();}
  },20000);
});
afterAll(()=>{if(process.env.SMARTDD_W14_NATIVE_EVIDENCE)writeFileSync(process.env.SMARTDD_W14_NATIVE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'I',worker,workerSha256:worker?createHash('sha256').update(readFileSync(worker)).digest('hex'):null,native,rows,boundary:'Actual FileService/root/native and exact r125 packaged Worker bytes on retained frozen filesystem (all chunks/dependencies). Independent Python ZIP/XML oracle. API operations are I,not UI/A;no LibreOffice layout or clipboard/picker.'},null,2)+'\n');});
