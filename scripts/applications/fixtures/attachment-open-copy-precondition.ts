// I fixture only: original export store writes an owned copy while the App is closed.
// No dialog, user approval, reply/import/send or native opening is simulated here.
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {MailBlobStore} from '../../../src/main/core/applications/mail-blob-store';
import {MailDraftService} from '../../../src/main/core/applications/mail-draft-service';
import {AttachmentExportStore} from '../../../src/main/core/applications/attachment-export-store';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
import {digest} from '../../../src/main/core/applications/manifest';
async function main(){
 const [userData,projectId,identityNative,fileNative,inputFile,output]=process.argv.slice(2);
 if(!/^\/private\/tmp\/willyou-m10-attachment-view-[a-zA-Z0-9]+\/userdata$/.test(userData)||!output.startsWith(dirname(userData)+'/output/'))throw Error('Own fresh closed-App export fixture only');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));
 let exports:AttachmentExportStore|undefined;
 try{
  const store=new ResourceStore(db,userData,undefined,{processes:new MacProcessIdentityReader(identityNative)}),policy={requireDrafts:(actor:{projectId:string})=>{if(actor.projectId!==projectId)throw Error('Own project only');}},actor={projectId,taskId:null};
  const blobs=new MailBlobStore(store,join(userData,'app-data/mail'),policy),drafts=new MailDraftService(store,blobs,policy),{target,view}=JSON.parse(readFileSync(inputFile,'utf8'));
  const draft=drafts.get(actor,target.draftId,target.revision),attachment=draft.attachments.find(a=>a.id===target.attachmentId);
  if(!attachment||attachment.contentHash!==view.contentHash)throw Error('Original draft member required');
  const bytes=blobs.read(actor,target.attachmentId);if(digest(bytes)!==view.contentHash||bytes.length!==view.size)throw Error('Original stable PDF required');
  exports=new AttachmentExportStore(store.storeId,blobs.root,userData,fileNative);
  const result=await exports.prepare({projectId,owner:'TS-closed-fixture',target,view,bytes,path:output,readonlyPaths:[],check:async()=>{if(digest(blobs.read(actor,target.attachmentId))!==view.contentHash)throw Error('Original changed');}});
  if(result.state!=='saved'||result.cleanupPending)throw Error('Fixture copy must be positively saved');
  db.pragma('wal_checkpoint(TRUNCATE)');console.log(JSON.stringify({pid:process.pid,result,output:realpathSync(output),layer:'I closed-App real export store/native copy only;not native Save UI'}));
 }finally{await exports?.dispose();db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
