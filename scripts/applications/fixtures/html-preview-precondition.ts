// Closed-App synthetic saved bodies. Not Agent creation, SMTP or client parity.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {MailBlobStore} from '../../../src/main/core/applications/mail-blob-store';
import {MailDraftService} from '../../../src/main/core/applications/mail-draft-service';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
async function main(){
 const userData=realpathSync(process.argv[2]),projectId=process.argv[3],helper=process.argv[4],port=Number(process.argv[5]);
 if(!/^\/private\/tmp\/willyou-m10-html-preview-[a-zA-Z0-9]+\/userdata$/.test(userData)||!helper.startsWith('/private/tmp/willyou-m10-')||!Number.isInteger(port)||port<1024||port>65535)throw Error('Own fresh HTML test only');
 const require=createRequire(join(process.cwd(),'package.json')),Database=require('better-sqlite3'),db=new Database(join(userData,'smartdd.db'));db.pragma('foreign_keys=ON');
 try{
  if(!db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId)||db.prepare('SELECT 1 FROM mail_drafts').get()||db.prepare('SELECT 1 FROM mail_send_intents').get()||db.prepare('SELECT 1 FROM app_secrets').get())throw Error('Fresh private body fixture required');
  const store=new ResourceStore(db,userData,undefined,{processes:new MacProcessIdentityReader(helper)}),actor={projectId,taskId:null},policy={requireDrafts:(a:{projectId:string})=>{if(a.projectId!==projectId)throw Error('Fixture project only');}},blobs=new MailBlobStore(store,join(userData,'app-data/mail'),policy),drafts=new MailDraftService(store,blobs,policy),url='http://127.0.0.1:'+port;
  const hostile='<p>OQ HTML 可读正文 &amp; 中文</p><script>window.__oqAttack=1;fetch("'+url+'/script")</script><style>@import url("'+url+'/style");</style><img src="'+url+'/pixel" onerror="window.__oqAttack=2"><iframe src="'+url+'/frame"></iframe><object data="'+url+'/object"></object><embed src="'+url+'/embed"><svg onload="window.__oqAttack=3"><image href="'+url+'/svg"/></svg><a href="javascript:window.__oqAttack=4">OQ 链接文字</a><form action="'+url+'/submit"><input autofocus><button>OQ 表单文字</button></form><p>OQ HTML 结束</p>';
  const rows=[];
  for(const [name,html]of [['hostile',hostile],['chunked','<p>OQ 分块起点 '+('中文🙂'.repeat(8500))+' OQ 分块终点</p>'],['plain',null]]as const){
   const d=await drafts.create(actor,{operationId:randomUUID(),content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'OQ '+name,text:'OQ plain fallback '+name,html,inReplyTo:null,references:[],attachmentIds:[]}});rows.push({name,id:d.id,revision:d.revision,contentHash:d.contentHash,htmlBytes:html===null?0:Buffer.byteLength(html),plain:d.content.text,html});
  }
  if(db.pragma('foreign_key_check').length)throw Error('Invalid fixture');db.pragma('wal_checkpoint(TRUNCATE)');console.log(JSON.stringify({pid:process.pid,projectId,rows,boundary:'Closed App;real draft service;synthetic body data only;no SMTP/source/import/grant/CLI'}));
 }finally{db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
