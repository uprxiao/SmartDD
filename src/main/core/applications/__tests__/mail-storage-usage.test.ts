import Database from 'better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runBundledMigrations} from '../../../db/migrations';
import {ResourceStore} from '../resource-store';
import {MailBlobStore} from '../mail-blob-store';
import {mailBusinessUsage,measureStorageTree} from '../mail-storage-usage';
let root:string,db:Database.Database,store:ResourceStore,blobs:MailBlobStore;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-storage-')));db=new Database(join(root,'state.sqlite'));runBundledMigrations(db);store=new ResourceStore(db,root);blobs=new MailBlobStore(store,join(root,'app-data/mail'),{requireDrafts:()=>{}});});
afterEach(()=>{db?.close();rmSync(root,{recursive:true,force:true});});
describe('mail storage read-only file-length inventory',()=>{
 it('measures owned business files and the shared database without assigning shared SQLite pages to mail',async()=>{
  const usage=await mailBusinessUsage(store,blobs.root),marker=join(blobs.root,'.willyou-mail-owner.json');expect(usage.files).toEqual({bytes:lstatSync(marker).size,complete:true});expect(usage.sharedDatabase).toEqual({bytes:lstatSync(db.name).size,complete:true});expect(usage.drafts).toBe(0);expect(usage.sends).toBe(0);
 });
 it('counts staging and unrecognized regular business files without parsing or exposing their contents',async()=>{
  const before=(await mailBusinessUsage(store,blobs.root)).files.bytes!;writeFileSync(join(blobs.root,'staging/private-pending'),Buffer.alloc(81));writeFileSync(join(blobs.root,'private-unrecognized'),'business-body-canary');const usage=await mailBusinessUsage(store,blobs.root);expect(usage.files).toEqual({bytes:before+81+Buffer.byteLength('business-body-canary'),complete:true});expect(JSON.stringify(usage)).not.toContain('canary');expect(readFileSync(join(blobs.root,'private-unrecognized'),'utf8')).toBe('business-body-canary');
 });
 it('counts each physical inode once when names refer to the same business file',async()=>{
  const dir=join(root,'plain');mkdirSync(dir);writeFileSync(join(dir,'first'),Buffer.alloc(123));linkSync(join(dir,'first'),join(dir,'second'));expect(await measureStorageTree(dir)).toEqual({bytes:123,complete:true});
 });
 it('reports incomplete instead of following a nested link into another data root',async()=>{
  const outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'private'),'outside-canary');symlinkSync(outside,join(blobs.root,'blobs/linked'));const usage=await mailBusinessUsage(store,blobs.root);expect(usage.files).toEqual({bytes:null,complete:false});expect(readFileSync(join(outside,'private'),'utf8')).toBe('outside-canary');expect(JSON.stringify(usage)).not.toContain(outside);
 });
 it('refuses a substituted business root and leaves both original and linked roots untouched',async()=>{
  const original=blobs.root+'-original';renameSync(blobs.root,original);const outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'canary'),'keep');symlinkSync(outside,blobs.root);expect((await mailBusinessUsage(store,blobs.root)).files).toEqual({bytes:null,complete:false});expect(readFileSync(join(outside,'canary'),'utf8')).toBe('keep');expect(lstatSync(original).isDirectory()).toBe(true);
 });
 it('requires the current store owner marker even when all files can be measured',async()=>{
  writeFileSync(join(blobs.root,'.willyou-mail-owner.json'),JSON.stringify({schema:1,storeId:'different-store'}));expect((await mailBusinessUsage(store,blobs.root)).files).toEqual({bytes:null,complete:false});
 });
 it('keeps a missing business tree unavailable and never creates it during inventory',async()=>{
  rmSync(blobs.root,{recursive:true});expect((await mailBusinessUsage(store,blobs.root)).files).toEqual({bytes:null,complete:false});expect(()=>lstatSync(blobs.root)).toThrow();
 });
 it('includes actual WAL and shared-memory files once in the separately labeled shared database snapshot',async()=>{
  db.pragma('journal_mode=WAL');db.exec('CREATE TABLE storage_probe(value TEXT);INSERT INTO storage_probe VALUES(\'safe\')');const expected=['','-wal','-shm'].reduce((sum,suffix)=>sum+lstatSync(db.name+suffix).size,0);expect((await mailBusinessUsage(store,blobs.root)).sharedDatabase).toEqual({bytes:expected,complete:true});
 });
 it('does not mistake a directory beginning with two dots for a parent escape',async()=>{
  const dir=join(root,'plain');mkdirSync(join(dir,'..notes'),{recursive:true});writeFileSync(join(dir,'..notes/file'),'safe');expect(await measureStorageTree(dir)).toEqual({bytes:4,complete:true});
 });
 it('bounds traversal depth and reports unknown bytes instead of a misleading partial total',async()=>{
  const dir=join(root,'deep');mkdirSync(dir);let current=dir;for(let i=0;i<34;i++){current=join(current,'d');mkdirSync(current);}writeFileSync(join(current,'keep'),'deep-canary');expect(await measureStorageTree(dir)).toEqual({bytes:null,complete:false});expect(readFileSync(join(current,'keep'),'utf8')).toBe('deep-canary');
 });
});
