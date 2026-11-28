// Closed-App synthetic fixture only. Same blob/draft services as attachment-view-precondition.ts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,realpathSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {ResourceStore} from '../../../src/main/core/applications/resource-store';
import {MailBlobStore} from '../../../src/main/core/applications/mail-blob-store';
import {MailDraftService} from '../../../src/main/core/applications/mail-draft-service';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';

const repo='/Users/liubu/hx/4.uprxiao/SmartDD';
const native=join(repo,'release/m16-qa-support/c28/build/mac-arm64/WillYou.app/Contents/Resources/native/willyou-process-identity');
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function main(){
 const [data,projectId,bootPid,dbSha,pin]=process.argv.slice(2);
 assert(/^\/private\/tmp\/willyou-m16-b08-attachment-c28-[a-zA-Z0-9]+\/data$/.test(data));
 assert.equal(realpathSync(data),data);
 assert.equal(process.execPath,realpathSync(join(repo,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')));
 assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1');
 assert.equal(process.env.HOME,join(dirname(data),'home'));
 assert.equal(hash(native),pin);
 assert.throws(()=>process.kill(Number(bootPid),0),{code:'ESRCH'});
 const dbPath=join(data,'smartdd.db');
 assert.equal(realpathSync(dbPath),dbPath);assert.equal(hash(dbPath),dbSha);
 assert(!existsSync(dbPath+'-wal'));
 const require=createRequire(join(repo,'package.json')),Database=require('better-sqlite3');
 const memory=new Database(':memory:');assert.equal(memory.prepare('SELECT 1 AS ready').get().ready,1);memory.close();
 const db=new Database(dbPath,{fileMustExist:true});db.pragma('foreign_keys=ON');
 try{
  assert(db.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId));
  for(const table of ['mail_drafts','mail_attachment_objects','mail_send_intents','app_secrets'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  const store=new ResourceStore(db,data,undefined,{processes:new MacProcessIdentityReader(native)}),actor={projectId,taskId:null};
  const policy={requireDrafts:(a:{projectId:string})=>assert.equal(a.projectId,projectId)};
  const blobs=new MailBlobStore(store,join(data,'app-data/mail'),policy),drafts=new MailDraftService(store,blobs,policy);
  const bytes=Buffer.from([0,1,2,255]);
  const attachment=await blobs.save(actor,{operationId:randomUUID(),filename:'M16-B08-binary.bin',contentType:'application/octet-stream'},bytes);
  const draft=await drafts.create(actor,{operationId:randomUUID(),content:{mode:'new',sourceMessageRef:null,senderConnectionId:null,to:[],cc:[],bcc:[],subject:'M16 B08 synthetic attachment',text:'M16 B08 synthetic body',html:null,inReplyTo:null,references:[],attachmentIds:[attachment.id]}});
  assert.deepEqual(blobs.read(actor,attachment.id),bytes);assert.deepEqual(db.pragma('foreign_key_check'),[]);
  db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(JSON.stringify({pid:process.pid,projectId,draftId:draft.id,revision:draft.revision,attachment,bytes:bytes.length,hash:createHash('sha256').update(bytes).digest('hex')}));
 }finally{db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
