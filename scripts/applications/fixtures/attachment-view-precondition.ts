// Closed-App stable attachment fixtures only; no import, credentials or sends.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {MailBlobStore} from '../../../src/main/core/applications/mail-blob-store';
import {MailDraftService} from '../../../src/main/core/applications/mail-draft-service';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
async function main(){
 const userData=realpathSync(process.argv[2]),projectId=process.argv[3],helper=process.argv[4],url=process.argv[5];if(!/^\/private\/tmp\/willyou-m10-attachment-view-[a-zA-Z0-9]+\/userdata$/.test(userData)||!helper.startsWith('/private/tmp/willyou-m10-')||!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))throw Error('Own fresh attachment fixture only');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId)||db.prepare('SELECT 1 FROM mail_drafts').get()||db.prepare('SELECT 1 FROM mail_send_intents').get()||db.prepare('SELECT 1 FROM app_secrets').get())throw Error('Fresh private baseline required');
  const store=new ResourceStore(db,userData,undefined,{processes:new MacProcessIdentityReader(helper)}),actor={projectId,taskId:null},policy={requireDrafts:(a:{projectId:string})=>{if(a.projectId!==projectId)throw Error('Fixture project only');}},blobs=new MailBlobStore(store,join(userData,'app-data/mail'),policy),drafts=new MailDraftService(store,blobs,policy),rows=[];
  const binary=await blobs.save(actor,{operationId:randomUUID(),filename:'binary.bin',contentType:'application/octet-stream'},Buffer.from([0,1,2,255]));
  for(const name of ['A','B']){
   const text=name==='A'?'<p>OR draft A 附件🙂</p><script>window.__oqAttack=1;fetch("'+url+'/draft")</script><img src="'+url+'/draft-pixel">':'OR draft B 同名不同内容🙂',contentType=name==='A'?'text/html':'text/plain',attachment=await blobs.save(actor,{operationId:randomUUID(),filename:'../同名附件.txt',contentType},Buffer.from(text)),d=await drafts.create(actor,{operationId:randomUUID(),content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'OR draft '+name,text:'OR plain body '+name,html:null,inReplyTo:null,references:[],attachmentIds:[attachment.id,binary.id]}});rows.push({name,id:d.id,revision:d.revision,contentHash:d.contentHash,attachment,text});
  }
  if(db.pragma('foreign_key_check').length)throw Error('Invalid fixture');db.pragma('wal_checkpoint(TRUNCATE)');console.log(JSON.stringify({pid:process.pid,projectId,rows,binary,boundary:'Closed-App synthetic stable attachment preparation through real blob/draft services;no import/SMTP/Agent/send grant'}));
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
