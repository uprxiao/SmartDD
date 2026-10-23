import {randomUUID,createHash} from 'node:crypto';
import {constants,openSync,closeSync,fsyncSync,lstatSync,readFileSync,writeFileSync,renameSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {z} from 'zod';
import type Database from 'better-sqlite3';
import type {ResourceStore} from '../core/applications/resource-store';
import {ensureStoreDirectory} from '../core/applications/package-files';
import type {DatabaseAccessLease} from './database-access-gate';
import type {MigrationRecord} from './migrations';
import type {MigrationBackupReceipt} from './migration-backup';

const watermark=z.object({tag:z.string().min(1).max(128),hash:z.string().min(1).max(128),when:z.number().finite()}).strict();
const recordSchema=z.object({schema:z.literal(1),kind:z.literal('database-migration'),operationId:z.uuid(),storeId:z.uuid(),buildId:z.string().min(1).max(256),createdAt:z.iso.datetime(),before:z.array(watermark).max(4096),target:z.array(watermark).max(4096),planHash:z.string().regex(/^[a-f0-9]{64}$/),state:z.enum(['prepared','backed-up','complete']),backup:z.object({operationId:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().nullable()}).strict();
export type MigrationJournal=z.infer<typeof recordSchema>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plan=(record:MigrationJournal)=>({operationId:record.operationId,storeId:record.storeId,buildId:record.buildId,createdAt:record.createdAt,before:record.before,target:record.target});
const sync=(path:string)=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};

/** File bootstrap authority before schema commit; DB operation authority after
 * commit. All updates require this U's exclusive cooperative maintenance lease. */
export class MigrationJournals {
 constructor(private store:ResourceStore,private lease:DatabaseAccessLease){}
 private guard(){this.lease.assertHeld();if(this.lease.mode!=='maintenance'||this.lease.root!==realpathSync(dirname(this.store.root)))throw new Error('迁移日志必须持有本数据库维护权');}
 private path(id:string){if(!z.uuid().safeParse(id).success)throw new Error('迁移操作编号无效');return join(ensureStoreDirectory(this.store.root,'operations'),id+'.json');}
 read(id:string):MigrationJournal{
  this.guard();const file=this.path(id),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>2*1024*1024)throw new Error('迁移日志文件身份无效');
  const value=recordSchema.parse(JSON.parse(readFileSync(file,'utf8')));
  if(value.operationId!==id||value.storeId!==this.store.storeId||value.planHash!==hash(plan(value))||JSON.stringify(value.target.slice(0,value.before.length))!==JSON.stringify(value.before)||(value.state!=='prepared'&&!value.backup))throw new Error('迁移日志计划不一致');return value;
 }
 create(input:{buildId:string;before:readonly MigrationRecord[];target:readonly MigrationRecord[]}):MigrationJournal{
  this.guard();const map=(rows:readonly MigrationRecord[])=>rows.map(({tag,hash,when})=>({tag,hash,when}));
  const value={schema:1 as const,kind:'database-migration' as const,operationId:randomUUID(),storeId:this.store.storeId,buildId:input.buildId,createdAt:new Date().toISOString(),before:map(input.before),target:map(input.target),planHash:'',state:'prepared' as const,backup:null};
  value.planHash=hash(plan(value));recordSchema.parse(value);if(JSON.stringify(value.target.slice(0,value.before.length))!==JSON.stringify(value.before))throw new Error('迁移起始水位不是目标前缀');
  const file=this.path(value.operationId);writeFileSync(file,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});sync(file);sync(dirname(file));return this.read(value.operationId);
 }
 private replace(prior:MigrationJournal,next:MigrationJournal){
  this.guard();if(JSON.stringify(this.read(prior.operationId))!==JSON.stringify(prior))throw new Error('迁移日志已变化');
  recordSchema.parse(next);const file=this.path(prior.operationId),stage=file+'.'+randomUUID()+'.next';writeFileSync(stage,JSON.stringify(next)+'\n',{flag:'wx',mode:0o600});sync(stage);this.guard();renameSync(stage,file);sync(dirname(file));
 }
 backedUp(id:string,receipt:MigrationBackupReceipt):MigrationJournal{
  const prior=this.read(id);if(prior.state!=='prepared'||receipt.state!=='verified'||receipt.buildId!==prior.buildId)throw new Error('迁移备份状态不匹配');
  const expected=prior.before.map(({hash,when})=>({hash,created_at:when}));if(JSON.stringify(receipt.migrations.map(({hash,created_at})=>({hash,created_at})))!==JSON.stringify(expected))throw new Error('迁移备份水位不一致');
  this.replace(prior,{...prior,state:'backed-up',backup:{operationId:receipt.operationId,sha256:receipt.sha256}});return this.read(id);
 }
 recordCommit(connection:Database.Database,id:string):void{
  this.guard();if(connection!==this.store.sqlite||!connection.inTransaction)throw new Error('迁移提交记录必须与本库迁移同事务');
  const value=this.read(id);if(value.state!=='backed-up')throw new Error('迁移提交前尚无已核验备份');this.assertWatermark(connection,value,true);
  connection.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'database-migration',?,'committed',?,?,?)").run(id,this.store.storeId,JSON.stringify(value),value.createdAt,new Date().toISOString());
 }
 private assertWatermark(connection:Database.Database,value:MigrationJournal,exact:boolean){
  const rows=connection.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all();const expected=value.target.map(({hash,when})=>({hash,created_at:when}));
  if((exact&&rows.length!==expected.length)||JSON.stringify(rows.slice(0,expected.length))!==JSON.stringify(expected))throw new Error('迁移提交水位与日志不一致');
 }
 completeFromDatabase(id:string):MigrationJournal{
  const prior=this.read(id),row=this.store.sqlite.prepare("SELECT kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE operation_id=?").get(id) as {kind:string;owner_store_id:string;state:string;plan_json:string}|undefined;
  if(!row||row.kind!=='database-migration'||row.owner_store_id!==this.store.storeId||row.state!=='committed')throw new Error('没有可核验的数据库迁移提交记录');
  const saved=recordSchema.parse(JSON.parse(row.plan_json));if(JSON.stringify({...prior,state:'backed-up'})!==JSON.stringify(saved))throw new Error('文件与数据库迁移计划不一致');
  this.assertWatermark(this.store.sqlite,prior,false);if(prior.state!=='complete')this.replace(prior,{...prior,state:'complete'});return this.read(id);
 }
}
