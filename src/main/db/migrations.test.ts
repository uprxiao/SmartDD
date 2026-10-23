import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { bundledMigrations, runBundledMigrations, runMigrations, type MigrationRecord } from './migrations';

const open: Database.Database[] = [];
function memoryDb(): Database.Database {
  const db = new Database(':memory:');
  open.push(db);
  return db;
}
afterEach(() => open.splice(0).forEach((db) => db.close()));

const ALL = ['0000_init', '0001_projects', '0002_tasks', '0003_ai_profile_check', '0004_capabilities', '0005_project_transfer', '0006_application_packages', '0007_application_connections', '0008_mail_drafts', '0009_mail_execution', '0010_capability_session_identity', '0011_capability_run_lifecycle', '0012_application_invocations', '0013_agent_adapters', '0014_discovery_catalog', '0015_builtin_package_sources', '0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials'];

const tables = (db: Database.Database) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const recorded = (db: Database.Database) =>
  (db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY id').all() as { hash: string }[]).map((r) => r.hash);

describe('bundled migrations', () => {
  it('adds and replays the original H binding anchor without rewriting old snapshots, references or source bytes',()=>{
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,25));
    db.exec("INSERT INTO capability_session_snapshots VALUES('old-h-task',0,'original fixed history','original-hash','2026-10-21T08:00:00Z','history-unknown','hold'); INSERT INTO capability_legacy_migration_preparations(task_id,source_snapshot_json,source_record_json,source_snapshot_hash,source_identity_json,state,created_at,updated_at) VALUES('old-h-task','original source bytes','original task bytes','original-source-hash','original identity','prepared','old-created','old-updated');");
    const original=db.prepare('SELECT * FROM capability_legacy_migration_preparations').get();expect(runBundledMigrations(db)).toEqual(['0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);expect(db.prepare('SELECT * FROM capability_legacy_migration_preparations').get()).toEqual({...original as object,h_binding_hash:null});expect(db.prepare('SELECT * FROM capability_legacy_h_bindings').all()).toEqual([]);
    db.exec("UPDATE capability_legacy_migration_preparations SET h_binding_hash='original-binding-hash'; INSERT INTO capability_legacy_h_bindings VALUES('old-h-task','original immutable alias receipt','original-binding-hash','original-binding-created'); DELETE FROM __drizzle_migrations WHERE id>=26;");
    expect(runBundledMigrations(db)).toEqual(['0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);expect(db.prepare('SELECT snapshot_json FROM capability_session_snapshots').get()).toEqual({snapshot_json:'original fixed history'});expect(db.prepare('SELECT h_binding_hash FROM capability_legacy_migration_preparations').get()).toEqual({h_binding_hash:'original-binding-hash'});expect(db.prepare('SELECT binding_json FROM capability_legacy_h_bindings').get()).toEqual({binding_json:'original immutable alias receipt'});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('preserves legacy unknown native history and observed evidence when the new nullable column is replayed', () => {
    const db=memoryDb();runMigrations(db,bundledMigrations().slice(0,24));
    db.exec("INSERT INTO tasks(id,cwd,runner,native_session_id,title,state_root,runtime_snapshot,created_at,updated_at) VALUES('legacy','/private/tmp/project','claude','original-id','original','/private/tmp/native','original snapshot bytes',1,2)");
    const original=db.prepare('SELECT * FROM tasks').get() as Record<string,unknown>;
    expect(runBundledMigrations(db)).toEqual(['0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT * FROM tasks').get()).toEqual({...original,native_history_observed:null});
    db.exec("UPDATE tasks SET native_history_observed=1; DELETE FROM __drizzle_migrations WHERE id>=25");
    expect(runBundledMigrations(db)).toEqual(['0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT * FROM tasks').get()).toEqual({...original,native_history_observed:1});
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('adds native-only restriction receipts without rewriting retained snapshots or the original preparation, including replay',()=>{
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,23));db.exec("INSERT INTO capability_session_snapshots VALUES('retained-task',2,'original snapshot bytes','original-hash','2026-10-21T00:00:00Z','created','active'); INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,snapshot_hash) VALUES('retained-run','retained-task','retained-project','codex','stopped','2026-10-21T00:00:00Z','original-hash'); INSERT INTO capability_run_preparations VALUES('retained-run','original preparation bytes','original-preparation-hash','2026-10-21T00:00:00Z');");expect(runBundledMigrations(db)).toEqual(['0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);db.exec("INSERT INTO capability_run_restrictions VALUES('retained-run','restriction bytes','restriction-hash','2026-10-21T00:00:01Z'); DELETE FROM __drizzle_migrations WHERE id>=24;");expect(runBundledMigrations(db)).toEqual(['0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);expect(db.prepare('SELECT snapshot_json FROM capability_session_snapshots').get()).toEqual({snapshot_json:'original snapshot bytes'});expect(db.prepare('SELECT evidence_json FROM capability_run_preparations').get()).toEqual({evidence_json:'original preparation bytes'});expect(db.prepare('SELECT evidence_json FROM capability_run_restrictions').get()).toEqual({evidence_json:'restriction bytes'});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('adds canonical H locations without changing existing C resource IDs, paths or foreign-key references', () => {
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,14));
    db.exec("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity) VALUES('original','runtime','original-hash','original-store','C','runtime/original','ready',1,'valid'); INSERT INTO capability_agent_adapters VALUES('codex','1.0.0','original-hash','original','{}');");
    expect(runBundledMigrations(db)).toEqual(['0014_discovery_catalog','0015_builtin_package_sources','0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT resource_id,relative_path,scope_identity,scope_relative_path FROM capability_resources').get()).toEqual({resource_id:'original',relative_path:'runtime/original',scope_identity:'original-store',scope_relative_path:null});
    expect(db.prepare('SELECT resource_id FROM capability_agent_adapters').get()).toEqual({resource_id:'original'});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.prepare('DELETE FROM __drizzle_migrations WHERE id>14').run();expect(runBundledMigrations(db)).toEqual(['0014_discovery_catalog','0015_builtin_package_sources','0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
  });

  it('adds builtin-source provenance without approving historical packages and preserves proofs on replay', () => {
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,15));
    db.exec("INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity) VALUES('old-package-resource','application-package','old-package','owned-store','C','apps/mail/0.9.0/old-package','ready',1,'valid'); INSERT INTO capability_packages VALUES('old-package','mail','0.9.0','app-manifest-v1','apps/mail/0.9.0/old-package','{}','old-package-resource','2026-10-20T00:00:00Z');");
    expect(runBundledMigrations(db)).toEqual(['0015_builtin_package_sources','0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT package_hash,version FROM capability_packages').get()).toEqual({package_hash:'old-package',version:'0.9.0'});
    expect(db.prepare('SELECT * FROM capability_builtin_package_sources').all()).toEqual([]);
    db.prepare('INSERT INTO capability_builtin_package_sources VALUES(?,?,?,?)').run('old-package','test-proof-hash','test proof retained','2026-10-20T00:00:00Z');
    db.exec('DELETE FROM __drizzle_migrations WHERE id>15');expect(runBundledMigrations(db)).toEqual(['0015_builtin_package_sources','0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT source_index_json FROM capability_builtin_package_sources').get()).toEqual({source_index_json:'test proof retained'});
    expect(()=>db.prepare('DELETE FROM capability_packages WHERE package_hash=?').run('old-package')).toThrow(/FOREIGN KEY/);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('adds scoped business operations without rewriting old project selection,drafts or retained resources on replay',()=>{
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,16));
    db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','retained business',1,1); INSERT INTO application_project_settings VALUES('p','mail',1,9,NULL,'2026-10-20T00:00:00Z'); INSERT INTO mail_drafts(id,project_id,source_task_id,subject,attachment_count,current_revision,state,created_at,updated_at) VALUES('d','p','old-task','retained',0,1,'draft','2026-10-20T00:00:00Z','2026-10-20T00:00:00Z'); INSERT INTO mail_draft_revisions VALUES('d',1,'original body JSON','original-content-hash','old-task','2026-10-20T00:00:00Z');");
    expect(runBundledMigrations(db)).toEqual(['0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT binding_revision,policy_revision FROM application_project_settings').get()).toEqual({binding_revision:9,policy_revision:0});
    db.exec("UPDATE application_project_settings SET policy_revision=7; INSERT INTO application_data_resources VALUES('r','p','mail','mail-draft-v1','d','1','text',1,'mail.draft','hash',1,'text/plain','retained-package','original-operation','2026-10-20T00:00:00Z'); DELETE FROM __drizzle_migrations WHERE id>=17");
    expect(runBundledMigrations(db)).toEqual(['0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT binding_revision,policy_revision FROM application_project_settings').get()).toEqual({binding_revision:9,policy_revision:7});expect(db.prepare('SELECT content_json,content_hash FROM mail_draft_revisions').get()).toEqual({content_json:'original body JSON',content_hash:'original-content-hash'});
    expect(db.prepare('SELECT resource_id,minted_package_hash FROM application_data_resources').get()).toEqual({resource_id:'r',minted_package_hash:'retained-package'});
    db.exec("DELETE FROM projects WHERE id='p'");expect(db.prepare('SELECT id,project_id FROM mail_drafts').get()).toEqual({id:'d',project_id:'p'});expect(db.prepare('SELECT resource_id FROM application_data_resources').get()).toEqual({resource_id:'r'});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps indexed background work read-only and requires real role-specific identities at the database boundary',()=>{
    const db=memoryDb();runBundledMigrations(db);
    const put=db.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,task_id,run_id,job_id,parent_operation_id,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES(?,?,?,?,?,?,?,?,'mail','fixed-package',1,'fixture','read','scope','running','2026-10-20T00:00:00Z')");
    put.run('ui','ui','project','p',null,null,null,null);put.run('manage','ui','connection-management',null,null,null,null,null);put.run('agent','agent-run','project','p','task','run',null,null);put.run('index','index-job','internal-index','p',null,null,'job','ui');
    for(const row of [['missing-run','agent-run','project','p','task',null,null,null],['fake-task','ui','project','p','task',null,null,null],['bad-index','index-job','project','p',null,null,'job','ui']])expect(()=>put.run(...row)).toThrow(/CHECK/);
    expect(()=>db.exec("UPDATE application_data_operations SET semantics='write' WHERE operation_id='index'")).toThrow(/CHECK/);
  });

  it('adds source-scoped ZenTao reads and preserves fetched revisions,binary files and receipt provenance on replay',()=>{
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,17));
    db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p','retained Zentao',1,1); INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,policy_revision,updated_at) VALUES('p','zentao',1,5,3,'2026-10-20T00:00:00Z');");
    expect(runBundledMigrations(db)).toEqual(['0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    db.prepare('INSERT INTO application_zentao_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run('owned-object','p','source-connection',1,'story','9007199254740997','revision','detail','original JSON','2026-10-20T00:00:00Z');
    db.prepare('INSERT INTO application_zentao_files VALUES(?,?,?,?,?,?,?)').run('owned-object','7','binary-hash',Buffer.from([0,255]),'application/octet-stream',2,'2026-10-20T00:00:00Z');
    db.exec("INSERT INTO application_read_receipt_checks VALUES('check','original','2026-10-20T00:00:00Z'); DELETE FROM __drizzle_migrations WHERE id>=18");expect(runBundledMigrations(db)).toEqual(['0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT native_id,payload_json FROM application_zentao_revisions').get()).toEqual({native_id:'9007199254740997',payload_json:'original JSON'});expect(db.prepare('SELECT bytes FROM application_zentao_files').get()).toEqual({bytes:Buffer.from([0,255])});
    expect(db.prepare('SELECT check_operation_id,original_operation_id FROM application_read_receipt_checks').get()).toEqual({check_operation_id:'check',original_operation_id:'original'});
    expect(db.prepare('SELECT binding_revision,policy_revision FROM application_project_settings').get()).toEqual({binding_revision:5,policy_revision:3});db.exec("DELETE FROM projects WHERE id='p'");expect(db.prepare('SELECT project_id FROM application_zentao_revisions').get()).toEqual({project_id:'p'});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('adds mail shared-index lineage and receipt proofs without rewriting original operations or their real caller roles',()=>{
    const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,18));
    db.exec("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,task_id,run_id,job_id,parent_operation_id,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES('ui','ui','project','p',NULL,NULL,NULL,NULL,'mail','original',1,'mail.query','read','scope','succeeded','2026-10-20T00:00:00Z'),('index','index-job','internal-index','p',NULL,NULL,'index','ui','mail','original',1,'mail.refresh','read','scope','succeeded','2026-10-20T00:00:00Z')");
    expect(runBundledMigrations(db)).toEqual(['0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);db.exec("INSERT INTO application_index_waiters VALUES('index','ui','source','2026-10-20T00:00:00Z',NULL,'waiting'); INSERT INTO application_mail_operation_sources VALUES('ui','source','revision','query','original source proof','2026-10-20T00:00:00Z'); DELETE FROM __drizzle_migrations WHERE id>=19");
    expect(runBundledMigrations(db)).toEqual(['0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);expect(db.prepare('SELECT provenance_json FROM application_mail_operation_sources').get()).toEqual({provenance_json:'original source proof'});expect(db.prepare('SELECT parent_operation_id,state FROM application_index_waiters').get()).toEqual({parent_operation_id:'ui',state:'waiting'});expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(()=>db.exec("INSERT INTO application_index_waiters VALUES('index','forged','source','2026-10-20T00:00:00Z',NULL,'waiting')")).toThrow(/FOREIGN KEY/);expect(()=>db.exec("UPDATE application_index_waiters SET state='invented'")).toThrow(/CHECK/);
  });

  it('loads every journal entry with its SQL and hash', () => {
    const migrations = bundledMigrations();
    expect(migrations.map((m) => m.tag)).toEqual(ALL);
    expect(migrations[0].sql).toContain('app_settings');
    expect(migrations[1].sql).toContain('project_databases');
    expect(migrations[2].sql).toContain('ai_profiles');
    expect(migrations[3].sql).toContain('check_status');
    for (const m of migrations) expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates the schema on an empty database and records the hash', () => {
    const db = memoryDb();
    expect(runBundledMigrations(db)).toEqual(ALL);
    expect(tables(db)).toEqual([
      '__drizzle_migrations',
      'ai_profiles',
      'app_secrets',
      'app_settings',
      'application_activity_subjects',
      'application_binding_changes',
      'application_binding_slot_revisions',
      'application_catalog_state',
      'application_connections',
      'application_data_operations',
      'application_data_resources',
      'application_host_applications',
      'application_host_providers',
      'application_index_waiters',
      'application_invocations',
      'application_mail_operation_sources',
      'application_project_bindings',
      'application_project_settings',
      'application_read_receipt_checks',
      'application_secret_changes',
      'application_zentao_cursors',
      'application_zentao_files',
      'application_zentao_operation_objects',
      'application_zentao_operation_resources',
      'application_zentao_revisions',
      'capability_active_packages',
      'capability_agent_adapters',
      'capability_bridge_observations',
      'capability_broker_denials',
      'capability_builtin_package_sources',
      'capability_discovery_roots',
      'capability_install_journal',
      'capability_lease_resources',
      'capability_legacy_h_bindings',
      'capability_legacy_migration_preparations',
      'capability_package_contracts',
      'capability_packages',
      'capability_resource_dependencies',
      'capability_resource_leases',
      'capability_resource_operations',
      'capability_resources',
      'capability_run_activities',
      'capability_run_preparations',
      'capability_run_processes',
      'capability_run_restrictions',
      'capability_runs',
      'capability_schema_migrations',
      'capability_session_holds',
      'capability_session_identities',
      'capability_session_mcp_names',
      'capability_session_refs',
      'capability_session_snapshots',
      'capability_skill_observations',
      'capability_snapshot_versions',
      'capability_store_state',
      'imported_keys',
      'mail_attachment_objects',
      'mail_blob_objects',
      'mail_blob_writes',
      'mail_draft_mutations',
      'mail_draft_revisions',
      'mail_drafts',
      'mail_send_executions',
      'mail_send_grants',
      'mail_send_intents','mail_user_action_sources',
      'project_capabilities',
      'project_databases',
      'project_dirs',
      'project_import_receipts',
      'project_servers',
      'projects',
      'sessions',
      'skill_versions',
      'tasks',
    ]);
    expect(columns(db, 'app_settings')).toEqual(['key', 'value', 'updated_at']);
    expect(recorded(db)).toEqual(bundledMigrations().map((m) => m.hash));
  });

  it('upgrades existing draft attachments and seeds independent nullable connection-slot revisions without resetting data', () => {
    const db = memoryDb(); runMigrations(db,bundledMigrations().slice(0,9));
    db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('old-project','kept',1,1)");
    db.exec("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,updated_at) VALUES('old-project','mail',1,7,'2026-10-20T00:00:00Z')");
    db.exec("INSERT INTO mail_blob_objects VALUES('old-content',3,'2026-10-20T00:00:00Z'); INSERT INTO mail_attachment_objects(id,project_id,content_hash,filename,content_type,byte_size,created_at) VALUES('old-attachment','old-project','old-content','old.txt','text/plain',3,'2026-10-20T00:00:00Z')");
    expect(runBundledMigrations(db)).toEqual(['0009_mail_execution','0010_capability_session_identity','0011_capability_run_lifecycle','0012_application_invocations','0013_agent_adapters', '0014_discovery_catalog', '0015_builtin_package_sources', '0016_application_data_operations','0017_zentao_business_reads','0018_mail_index_provenance','0019_mail_user_action_sources','0020_application_activity_subjects','0021_capability_run_evidence','0022_legacy_task_migration_preparations','0023_capability_run_restrictions','0024_native_history_observation','0025_legacy_h_bindings','0026_registered_application_hosts','0027_capability_skill_observations','0028_capability_broker_denials']);
    expect(db.prepare('SELECT id,kind,filename FROM mail_attachment_objects').all()).toEqual([{ id: 'old-attachment',kind: 'attachment',filename: 'old.txt' }]);
    expect(db.prepare('SELECT slot,revision FROM application_binding_slot_revisions ORDER BY slot').all()).toEqual([{ slot: 'foxmail',revision: 7 },{ slot: 'smtp',revision: 7 }]);
    db.exec('DELETE FROM __drizzle_migrations WHERE id>=10'); runBundledMigrations(db); expect(db.prepare('SELECT count(*) AS n FROM mail_attachment_objects').get()).toEqual({ n: 1 });
  });

  it('retains native run history after project deletion and skips its completed FK rebuild on replay', () => {
    const db = memoryDb(); runMigrations(db,bundledMigrations().slice(0,10));
    db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('retained-project','history',1,1)");
    db.exec("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES('history-task',2,'{}','fixture-hash','2026-10-20T00:00:00Z','created','tombstone')");
    db.exec("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES('historical-run','history-task','retained-project','codex','stopped','2026-10-20T00:00:00Z')");
    runBundledMigrations(db); db.exec("DELETE FROM projects WHERE id='retained-project'");
    expect(db.prepare('SELECT run_id,project_id,state FROM capability_runs').all()).toEqual([{ run_id: 'historical-run',project_id: 'retained-project',state: 'stopped' }]);
    db.exec('DELETE FROM __drizzle_migrations WHERE id=11'); runBundledMigrations(db);
    expect(db.prepare('SELECT count(*) AS n FROM capability_runs').get()).toEqual({ n: 1 }); expect(tables(db)).not.toContain('capability_runs_retained');
  });

  it('is a no-op the second time', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    expect(runBundledMigrations(db)).toEqual([]);
    expect(recorded(db)).toHaveLength(ALL.length);
  });

  it('re-runs 0001 safely when its tables exist but the record is missing', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'kept', 1, 1)");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 1');
    expect(runBundledMigrations(db)).toEqual(ALL.slice(1));
    expect(db.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'kept' }]);
  });

  it('re-runs 0002 without duplicating tasks copied from sessions', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO sessions VALUES ('s1', 'codex', '/tmp', 'n1', 'old', 5)");
    db.exec("UPDATE tasks SET title = 'renamed' WHERE id = 's1'");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 2');
    expect(runBundledMigrations(db)).toEqual(ALL.slice(2));
    expect(db.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 's1', title: 'old' }]);
    db.exec("UPDATE tasks SET title = 'renamed' WHERE id = 's1'");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 2');
    runBundledMigrations(db);
    expect(db.prepare('SELECT id, title FROM tasks').all()).toEqual([{ id: 's1', title: 'renamed' }]);
  });

  it('re-runs 0003 when its columns already exist, keeping the stored results', () => {
    const db = memoryDb();
    runBundledMigrations(db);
    db.exec("INSERT INTO ai_profiles (id, name, runner, check_status, created_at, updated_at) VALUES ('a1', 'cc', 'claude', 'failed', 1, 1)");
    db.exec('DELETE FROM __drizzle_migrations WHERE id > 3');
    expect(runBundledMigrations(db)).toEqual(ALL.slice(3));
    expect(columns(db, 'ai_profiles').filter((c) => c.startsWith('check_'))).toEqual([
      'check_status',
      'check_category',
      'check_source',
      'check_message',
      'check_ms',
      'check_at',
    ]);
    expect(db.prepare('SELECT check_status FROM ai_profiles').all()).toEqual([{ check_status: 'failed' }]);
  });

  it('adopts an M0 database without touching existing rows', () => {
    const db = memoryDb();
    // The M0 schema, created by hand before migrations existed.
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, runner TEXT NOT NULL, cwd TEXT NOT NULL,
        native_session_id TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE app_secrets (key TEXT PRIMARY KEY, secret BLOB NOT NULL);
      CREATE TABLE probe_kv (k TEXT PRIMARY KEY, v TEXT);
      INSERT INTO sessions VALUES ('s1', 'claude', '/tmp', NULL, 'old', 1);
    `);
    expect(runBundledMigrations(db)).toEqual(ALL);
    expect(tables(db)).toContain('app_settings');
    expect(tables(db)).toContain('probe_kv');
    expect(db.prepare('SELECT title FROM sessions').all()).toEqual([{ title: 'old' }]);
    expect(db.prepare('SELECT id, runner, cwd, title, project_id, created_at, last_launched_at FROM tasks').all()).toEqual([
      { id: 's1', runner: 'claude', cwd: '/tmp', title: 'old', project_id: null, created_at: 1, last_launched_at: 1 },
    ]);
  });
});

describe('runMigrations', () => {
  const m = (idx: number, sql: string): MigrationRecord => ({ idx, tag: `m${idx}`, when: idx, sql, hash: `h${idx}` });

  it('applies only the migrations past the recorded count', () => {
    const db = memoryDb();
    runMigrations(db, [m(0, 'CREATE TABLE a (x)')]);
    expect(runMigrations(db, [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x)')])).toEqual(['m1']);
    expect(tables(db)).toEqual(['__drizzle_migrations', 'a', 'b']);
    expect(recorded(db)).toEqual(['h0', 'h1']);
  });

  it('rolls back the whole batch when one statement fails', () => {
    const db = memoryDb();
    const batch = [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x);\n--> statement-breakpoint\nNOT SQL')];
    expect(() => runMigrations(db, batch)).toThrow();
    expect(tables(db)).toEqual(['__drizzle_migrations']);
    expect(recorded(db)).toEqual([]);
  });

  it('skips ADD COLUMN for a column that is already there', () => {
    const db = memoryDb();
    db.exec('CREATE TABLE a (x, y)');
    expect(runMigrations(db, [m(0, 'ALTER TABLE `a` ADD `y` text;\n--> statement-breakpoint\nALTER TABLE a ADD COLUMN z integer')])).toEqual(['m0']);
    expect(columns(db, 'a')).toEqual(['x', 'y', 'z']);
  });

  it('refuses a database migrated by a newer version', () => {
    const db = memoryDb();
    runMigrations(db, [m(0, 'CREATE TABLE a (x)'), m(1, 'CREATE TABLE b (x)')]);
    expect(() => runMigrations(db, [m(0, 'CREATE TABLE a (x)')])).toThrow(/更新版本/);
  });
});

it('upgrades and replays Skill observation metadata without changing retained runs',()=>{
 const db=memoryDb();db.pragma('foreign_keys=ON');runMigrations(db,bundledMigrations().slice(0,27));
 db.exec("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES('skill-history',2,'original snapshot','original hash','2026-10-23T00:00:00Z','created','tombstone'); INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at) VALUES('old-skill-run','skill-history','original-project','codex','stopped','2026-10-23T00:00:00Z');");
 const before=db.prepare('SELECT * FROM capability_runs').all();expect(runBundledMigrations(db)).toEqual(['0027_capability_skill_observations','0028_capability_broker_denials']);
 db.prepare('INSERT INTO capability_skill_observations VALUES(?,?,?,?,?,?,?)').run('old-skill-run','mail','assistant','read','metadata only','hash','2026-10-23T00:00:01Z');
 db.exec('DELETE FROM __drizzle_migrations WHERE id>=28');expect(runBundledMigrations(db)).toEqual(['0027_capability_skill_observations','0028_capability_broker_denials']);expect(db.prepare('SELECT * FROM capability_runs').all()).toEqual(before);expect(db.prepare('SELECT evidence_json FROM capability_skill_observations').get()).toEqual({evidence_json:'metadata only'});
 expect(()=>db.prepare('INSERT INTO capability_skill_observations VALUES(?,?,?,?,?,?,?)').run('foreign-run','mail','assistant','read','metadata','hash','time')).toThrow(/FOREIGN KEY/);
 expect(()=>db.prepare('INSERT INTO capability_skill_observations VALUES(?,?,?,?,?,?,?)').run('old-skill-run','mail','assistant','invented','metadata','hash','time')).toThrow(/CHECK/);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

 it('upgrades and replays broker-denial metadata without changing existing audit rows',()=>{
  const db=memoryDb();runMigrations(db,bundledMigrations().slice(0,28));
  expect(runBundledMigrations(db)).toEqual(['0028_capability_broker_denials']);
  db.prepare('INSERT INTO capability_broker_denials VALUES(?,?,?,?,?,?,?)').run('event','host',null,null,'unknown','INVALID_INPUT','2026-10-23T00:00:00Z');const before=db.prepare('SELECT * FROM capability_broker_denials').all();
  db.exec('DELETE FROM __drizzle_migrations WHERE id>=29');expect(runBundledMigrations(db)).toEqual(['0028_capability_broker_denials']);expect(db.prepare('SELECT * FROM capability_broker_denials').all()).toEqual(before);
  expect(()=>db.prepare('INSERT INTO capability_broker_denials VALUES(?,?,?,?,?,?,?)').run('bad','host','run',null,'unknown','INVALID_INPUT','2026-10-23T00:00:00Z')).toThrow();db.close();
 });
