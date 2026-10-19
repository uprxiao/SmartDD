import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {OfficePackage} from '@main/core/files/office/package';
import {OfficePagesModel} from '@main/core/files/office/pages-model';
import {officeOpenSchema} from '@shared/file-office';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function main(){
 assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1');assert(process.versions.electron);assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
 const app='/private/tmp/willyou-m9-acceptance-batch-r95-build/mac-arm64/WillYou.app',resources=join(app,'Contents/Resources');createRequire(join(resources,'app.asar/package.json'))('original-fs');const rows:unknown[]=[];
 for(const scenario of ['matching','different-source','empty-hash']){
  const base=mkdtempSync('/private/tmp/willyou-office-baseline-I-'),project=join(base,'project'),userdata=join(base,'userdata');mkdirSync(project);mkdirSync(userdata);const name='baseline.pptx',path=join(project,name),source=readFileSync(join(process.cwd(),'docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx'));writeFileSync(path,source);
  const broker=new NativeFileBroker(join(resources,'native/willyou-files')),resolver={sources:()=>[{kind:'project-directory' as const,id:'baseline',path:project,label:'Own baseline',projectId:'baseline'}]},service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,userdata,resolver),undefined,undefined,undefined,undefined,join(resources,'app.asar/out/main/m9-office-document.js'),undefined,undefined,join(resources,'app.asar/out/main/m9-pptx-document.js')),owner='baseline';
  try{
   const roots=await service.openScope(owner,{kind:'project',projectId:owner}),root=roots.roots[0],file=await service.open(owner,{lease:root.lease,generation:root.generation,relativePath:name}),id=randomUUID(),input={id,ref:file.ref,baseHash:scenario==='empty-hash'?'':file.revision.hash};assert.equal(file.revision.hash,sha(source));
   if(scenario==='different-source'){
    const changed=await OfficePackage.read(source),part='ppt/notesSlides/notesSlide1.xml',notes=changed.read(part);
    // A real independent byte revision, not an altered expected hash.
    const text=notes.toString();assert(text.includes('SLIDE_ONE_NOTES'));const patched=changed.patch(new Map([[part,Buffer.from(text.replace('SLIDE_ONE_NOTES','EXTERNAL_BASELINE'))]]),{changed:[part],added:[],removed:[]});
    writeFileSync(path,await patched.bytes());const external=sha(readFileSync(path));assert.notEqual(external,file.revision.hash);let error:unknown;try{await service.pptx.open(owner,input);}catch(value){error=value;}assert(error,'mismatched initial bytes must reject');assert.match(String(error),/CHANGED|改变|基线|版本/);assert.equal(sha(readFileSync(path)),external);assert.equal(service.pptx.activeDocuments,0);rows.push({scenario,baseHash:file.revision.hash,actualHash:external,error:String(error),pass:true});
   }else if(scenario==='empty-hash'){
    assert.equal(officeOpenSchema.safeParse(input).success,false);let error:unknown;try{await service.pptx.open(owner,input);}catch(value){error=value;}assert(error);assert.equal(service.pptx.activeDocuments,0);assert.equal(sha(readFileSync(path)),sha(source));rows.push({scenario,rejectedByOriginalSchema:true,error:String(error),sourceUnchanged:true,pass:true});
   }else{
    assert(officeOpenSchema.safeParse(input).success);const opened=await service.pptx.open(owner,input),slide=opened.state.info.slides[0],state=await service.pptx.edit(owner,{id,version:opened.state.version,action:{type:'notes',slideId:slide.id,text:'LATEST_MATCHING_BASELINE'}}),saved=await service.pptx.save(owner,{id,version:state.version,draftId:randomUUID(),bufferVersion:1,opId:randomUUID()});assert.equal(saved.receipt.state,'saved');assert.equal(saved.receipt.revision?.hash,sha(readFileSync(path)));const actual=new OfficePagesModel(await OfficePackage.read(readFileSync(path)));assert.equal(actual.info.slides[0].notes,'LATEST_MATCHING_BASELINE');rows.push({scenario,baseHash:file.revision.hash,savedHash:saved.receipt.revision?.hash,version:state.version,pass:true});
   }
  }finally{service.closeOwner(owner);await service.watcher.dispose();const end=Date.now()+10000;while(broker.activeProcesses){assert(Date.now()<end);await delay(5);}assert.equal(service.pptx.activeDocuments,0);broker.dispose();rmSync(base,{recursive:true,force:true});}
 }
 const result={at:new Date().toISOString(),caseId:'M9-T-J02',layer:'U/I only, A pending',app,rows,boundary:'Actual original schema + native FileService/source revision guard/packaged PPTX Worker. Matching source real edit/save/independent package read; source changed after file open rejects before owner remains; empty baseline schema rejects before Worker creation. Synthetic private fixtures only; no renderer or App interaction claimed.'};writeFileSync('/private/tmp/willyou-dev159-baseline-native-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'passed',cases:rows.length}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
