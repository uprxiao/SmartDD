import Database from 'better-sqlite3';
import {afterEach,describe,expect,it} from 'vitest';
import {bundledMigrations,runBundledMigrations,runMigrations} from './migrations';

const opened:Database.Database[]=[];
afterEach(()=>opened.splice(0).forEach(db=>db.close()));
const preserved=['application_connections','application_catalog_state','application_project_settings','application_project_bindings','application_binding_slot_revisions','application_secret_changes','mail_drafts','mail_draft_revisions','mail_send_intents','app_secrets','projects'] as const;
function oldDatabase(foreignKeys=true){
 const db=new Database(':memory:');opened.push(db);db.pragma('foreign_keys='+(foreignKeys?'ON':'OFF'));runMigrations(db,bundledMigrations().slice(0,26));
 db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','Original project',1,2)");
 db.prepare('INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('smtp-connection','mail','smtp','Original connection',' { "kind": "smtp", "original": true } ',9,6,4,' { "original": "identity bytes" } ','identity-hash','original-secret',3,7,1,'connected','healthy','created','updated');
 db.prepare('INSERT INTO app_secrets VALUES(?,?)').run('original-secret','sealed:original-fixture-ciphertext=');
 db.prepare('INSERT INTO application_secret_changes(operation_id,connection_id,expected_revision,old_secret_ref,new_secret_ref,candidate_hash,candidate_json,expires_at,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('pending-secret-op','smtp-connection',9,'original-secret','pending-new-secret','candidate-hash',' { "original": "candidate bytes" } ','original-expiry','validated','created','updated');
 db.exec(`INSERT INTO application_catalog_state VALUES('mail',1,1,8,'catalog-updated'); INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,pending_operation_id,updated_at,policy_revision) VALUES('p','mail',1,11,'original-pending','settings-updated',13); INSERT INTO application_project_bindings VALUES('p','mail','smtp','smtp-connection',4); INSERT INTO application_binding_slot_revisions VALUES('p','mail','smtp',17); INSERT INTO mail_drafts(id,project_id,subject,attachment_count,current_revision,state,created_at,updated_at) VALUES('draft','p','Original draft',0,1,'draft','created','updated'); INSERT INTO mail_draft_revisions VALUES('draft',1,' { "body": "original private content" } ','content-hash',NULL,'created');`);
 db.prepare('INSERT INTO mail_send_intents(id,project_id,operation_id,request_hash,draft_id,draft_revision,draft_content_hash,connection_id,identity_revision,config_revision,policy_revision,binding_revision,identity_json,smtp_config_json,raw_write_id,message_id,state,owner_instance_id,owner_pid,owner_started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('intent','p','original-op','request-hash','draft',1,'content-hash','smtp-connection',4,6,7,11,'original identity','original SMTP','raw-write','original-message-id','unknown','original-owner',42,'owner-start','created','updated');
 return db;
}
function rows(db:Database.Database){return Object.fromEntries(preserved.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}
function schema(db:Database.Database){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();}
function journal(db:Database.Database){return db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();}

describe('registered host migration preserves the original shared application store',()=>{
 it.each([true,false])('preserves every original row and original FK mode %s,including RESTRICT send intent references',foreignKeys=>{
  const db=oldDatabase(foreignKeys),before=rows(db);expect(runBundledMigrations(db)).toEqual(['0026_registered_application_hosts']);expect(rows(db)).toEqual(before);expect(db.pragma('foreign_keys',{simple:true})).toBe(Number(foreignKeys));expect(db.pragma('foreign_key_check')).toEqual([]);
  db.pragma('foreign_keys=ON');expect(()=>db.prepare('DELETE FROM application_connections WHERE id=?').run('smtp-connection')).toThrow(/FOREIGN KEY/);expect(rows(db)).toEqual(before);expect(runBundledMigrations(db)).toEqual([]);
 });
 it('replays the rebuild without deleting static host metadata,new connections or original references',()=>{
  const db=oldDatabase();runBundledMigrations(db);db.exec("INSERT INTO application_host_applications VALUES('extalpha'); INSERT INTO application_host_providers VALUES('extalpha','extalpha',1); INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES('ext','extalpha','extalpha','Extension','{}',1,1,1,'{}','hash',0,0,0,'disconnected','unverified','created','updated'); DELETE FROM __drizzle_migrations WHERE id=27;");
  const before=rows(db);expect(runBundledMigrations(db)).toEqual(['0026_registered_application_hosts']);expect(rows(db)).toEqual(before);expect(db.prepare("SELECT * FROM application_host_providers WHERE provider_id='extalpha'").get()).toEqual({provider_id:'extalpha',app_id:'extalpha',config_api_major:1});expect(db.pragma('foreign_key_check')).toEqual([]);
 });
 it('rolls back the entire rebuilt schema,all original rows and migration journal on a later SQL failure',()=>{
  const db=oldDatabase(),before=rows(db),ddl=schema(db),history=journal(db),migrations=bundledMigrations(),last=migrations[26];migrations[26]={...last,sql:last.sql+'\n--> statement-breakpoint\nINSERT INTO absent_migration_table VALUES(1);'};
  expect(()=>runMigrations(db,migrations)).toThrow(/absent_migration_table/);expect(rows(db)).toEqual(before);expect(schema(db)).toEqual(ddl);expect(journal(db)).toEqual(history);expect(db.pragma('foreign_keys',{simple:true})).toBe(1);expect(db.pragma('foreign_key_check')).toEqual([]);
 });
 it('rejects an orphan discovered before commit and restores the original bytes,schema,journal and FK mode',()=>{
  const db=oldDatabase(),before=rows(db),ddl=schema(db),history=journal(db),migrations=bundledMigrations(),last=migrations[26];migrations[26]={...last,sql:last.sql+"\n--> statement-breakpoint\nUPDATE application_project_bindings SET connection_id='absent';"};
  expect(()=>runMigrations(db,migrations)).toThrow(/外键核验失败/);expect(rows(db)).toEqual(before);expect(schema(db)).toEqual(ddl);expect(journal(db)).toEqual(history);expect(db.pragma('foreign_keys',{simple:true})).toBe(1);expect(db.pragma('foreign_key_check')).toEqual([]);
 });
 it('preserves and reports an already orphaned old database rather than silently discarding historical rows',()=>{
  const db=oldDatabase(false);db.exec("UPDATE application_project_bindings SET connection_id='historical-missing'");const before=rows(db),ddl=schema(db),history=journal(db),violations=db.pragma('foreign_key_check');expect(violations).not.toEqual([]);
  expect(()=>runBundledMigrations(db)).toThrow(/外键核验失败/);expect(rows(db)).toEqual(before);expect(schema(db)).toEqual(ddl);expect(journal(db)).toEqual(history);expect(db.pragma('foreign_keys',{simple:true})).toBe(0);expect(db.pragma('foreign_key_check')).toEqual(violations);
 });
 it('refuses nesting the rebuild in an existing transaction without touching original rows or disabling its FKs',()=>{
  const db=oldDatabase(),before=rows(db),ddl=schema(db),history=journal(db);db.transaction(()=>{expect(()=>runBundledMigrations(db)).toThrow(/独立迁移事务/);expect(db.inTransaction).toBe(true);expect(db.pragma('foreign_keys',{simple:true})).toBe(1);expect(rows(db)).toEqual(before);expect(schema(db)).toEqual(ddl);expect(journal(db)).toEqual(history);})();expect(db.pragma('foreign_keys',{simple:true})).toBe(1);
 });
 it('keeps cross-application and unregistered-provider connections and project slots rejected by SQLite',()=>{
  const db=oldDatabase();runBundledMigrations(db);expect(()=>db.exec("UPDATE application_connections SET app_id='zentao' WHERE id='smtp-connection'")).toThrow(/FOREIGN KEY/);expect(()=>db.exec("UPDATE application_connections SET provider_id='unregistered' WHERE id='smtp-connection'")).toThrow(/FOREIGN KEY/);expect(()=>db.exec("UPDATE application_project_bindings SET slot='zentao' WHERE project_id='p'")).toThrow(/FOREIGN KEY/);expect(()=>db.exec("UPDATE application_binding_slot_revisions SET slot='unregistered' WHERE project_id='p'")).toThrow(/FOREIGN KEY/);expect(db.pragma('foreign_key_check')).toEqual([]);
 });
});
