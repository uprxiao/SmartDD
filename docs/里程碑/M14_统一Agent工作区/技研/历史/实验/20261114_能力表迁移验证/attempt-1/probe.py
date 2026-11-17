"""Database-level migration experiment using all actual repository DDL.
Synthetic snapshot JSON is opaque preservation data, NOT schema-certified runtime input.
No live DB or production migration runner is used.
"""
from pathlib import Path
import hashlib,json,re,sqlite3,sys,tempfile,unittest

REPO=Path('/Users/hx/projects/SmartDD')
BASE=Path('/private/tmp/willyou-m14-cap-migration')

NEW_DDL='''
CREATE TABLE probe_bindings(
 binding_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, runner TEXT NOT NULL,
 identity_root TEXT NOT NULL, native_id TEXT, cwd TEXT NOT NULL,
 legacy_task_id TEXT UNIQUE REFERENCES capability_session_snapshots(task_id),
 UNIQUE(binding_id,task_id), UNIQUE(runner,identity_root,native_id));
CREATE TABLE probe_cap_sessions(
 cap_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, task_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,retention_state TEXT NOT NULL,
 legacy_task_id TEXT UNIQUE REFERENCES capability_session_snapshots(task_id),
 UNIQUE(cap_id,task_id,binding_id),
 FOREIGN KEY(binding_id,task_id) REFERENCES probe_bindings(binding_id,task_id));
CREATE TABLE probe_cap_refs(
 cap_id TEXT NOT NULL REFERENCES probe_cap_sessions(cap_id),
 ref_id TEXT NOT NULL REFERENCES capability_resources(resource_id),
 ref_kind TEXT NOT NULL,ref_hash TEXT NOT NULL,relative_path TEXT NOT NULL,
 PRIMARY KEY(cap_id,ref_id,ref_kind));
CREATE TABLE probe_migration_receipt(version INTEGER PRIMARY KEY,source_schema_hash TEXT NOT NULL);
'''


def h(x):return hashlib.sha256(x.encode()).hexdigest()


def migrate(db,failpoint=None):
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='probe_migration_receipt'").fetchone():
        if db.execute('SELECT 1 FROM probe_migration_receipt WHERE version=1').fetchone():return 'already-migrated'
    # These gates are DB-level facts only; the real host must also prove process termination.
    if db.execute("SELECT 1 FROM capability_runs WHERE state NOT IN ('stopped','failed') OR revocation_state='revoking'").fetchone():raise ValueError('live-or-unknown-run')
    if db.execute("SELECT 1 FROM capability_run_processes WHERE state NOT IN ('exited','canceled')").fetchone():raise ValueError('live-or-unknown-process')
    if db.execute("SELECT 1 FROM capability_resource_leases WHERE state<>'released'").fetchone():raise ValueError('resource-lease')
    assert not db.in_transaction
    old_sql=db.execute("SELECT sql FROM sqlite_master WHERE name='capability_runs'").fetchone()[0]
    old_cols=[r[1] for r in db.execute('PRAGMA table_info(capability_runs)')]
    indexes=[r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='capability_runs' AND sql IS NOT NULL")]
    db.execute('PRAGMA foreign_keys=OFF')
    assert db.execute('PRAGMA foreign_keys').fetchone()[0]==0
    try:
        db.execute('BEGIN IMMEDIATE')
        for statement in NEW_DDL.split(';'):
            if statement.strip():db.execute(statement)
        # Unknown/held snapshots stay in the legacy tables, without guessed bindings.
        db.execute('''INSERT INTO probe_bindings SELECT 'binding:'||s.task_id,s.task_id,i.runner,i.identity_root,i.session_id,i.cwd,s.task_id
          FROM capability_session_snapshots s JOIN capability_session_identities i ON i.task_id=s.task_id
          WHERE s.schema_version IN (2,3) AND s.retention_state<>'hold' ''')
        db.execute('''INSERT INTO probe_cap_sessions SELECT 'cap:'||s.task_id,b.binding_id,s.task_id,s.snapshot_json,s.snapshot_hash,s.retention_state,s.task_id
          FROM capability_session_snapshots s JOIN probe_bindings b ON b.legacy_task_id=s.task_id''')
        db.execute('''INSERT INTO probe_cap_refs SELECT c.cap_id,r.ref_id,r.ref_kind,r.ref_hash,r.relative_path
          FROM capability_session_refs r JOIN probe_cap_sessions c ON c.legacy_task_id=r.task_id''')
        # Keep the original capability_runs name and IDs so existing business FKs remain valid.
        new_sql=old_sql.replace('CREATE TABLE "capability_runs"','CREATE TABLE capability_runs_probe_new',1)
        assert 'REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT' in new_sql
        new_sql=new_sql.replace('REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT','',1)
        assert new_sql.rstrip().endswith(')')
        new_sql=new_sql.rstrip()[:-1]+''',
          capability_session_id TEXT,binding_id TEXT,
          execution_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(execution_mode IN ('legacy','programmatic')),
          CHECK((capability_session_id IS NULL)=(binding_id IS NULL)),
          CHECK(execution_mode='legacy' OR capability_session_id IS NOT NULL),
          FOREIGN KEY(capability_session_id,task_id,binding_id) REFERENCES probe_cap_sessions(cap_id,task_id,binding_id))'''
        db.execute(new_sql)
        names=','.join('"'+x+'"' for x in old_cols)
        db.execute('INSERT INTO capability_runs_probe_new('+names+') SELECT '+names+' FROM capability_runs')
        # Only exact snapshot-hash matches receive the new link. Older unresolved versions are retained.
        db.execute('''UPDATE capability_runs_probe_new SET
          capability_session_id=(SELECT c.cap_id FROM probe_cap_sessions c WHERE c.task_id=capability_runs_probe_new.task_id AND c.snapshot_hash=capability_runs_probe_new.snapshot_hash),
          binding_id=(SELECT c.binding_id FROM probe_cap_sessions c WHERE c.task_id=capability_runs_probe_new.task_id AND c.snapshot_hash=capability_runs_probe_new.snapshot_hash)''')
        db.execute('DROP TABLE capability_runs')
        if failpoint=='after-drop':raise RuntimeError('injected crash window after DROP')
        db.execute('ALTER TABLE capability_runs_probe_new RENAME TO capability_runs')
        for sql in indexes:db.execute(sql)
        if db.execute('PRAGMA foreign_key_check').fetchall():raise RuntimeError('invalid foreign keys')
        db.execute('INSERT INTO probe_migration_receipt VALUES(1,?)',(h(old_sql),))
        db.commit()
    except BaseException:
        db.rollback();raise
    finally:
        db.execute('PRAGMA foreign_keys=ON')
        assert db.execute('PRAGMA foreign_keys').fetchone()[0]==1
    return 'migrated'


def insert_run(db,name,task,runner='codex',snapshot='hash:active',**extra):
    values={'run_id':name,'task_id':task,'project_id':'retained-project','runner':runner,'state':'stopped','started_at':'synthetic-time','snapshot_hash':snapshot,'revocation_state':'revoked',**extra}
    db.execute('INSERT INTO capability_runs('+','.join(values)+') VALUES('+','.join('?' for _ in values)+')',list(values.values()))


def invocation(db,name,run,task):
    db.execute('''INSERT INTO application_invocations(operation_id,run_id,request_id,request_hash,project_id,task_id,app_id,package_hash,tool_name,contract_major,semantics,state,effect_state,started_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,'write','succeeded','completed','synthetic-time')''',(name,run,'request:'+name,'request-hash','retained-project',task,'mail','package-hash','synthetic_write'))


def seed(db):
    with db:
        for name in ['old-resource','new-resource']:
            db.execute("INSERT INTO capability_resources VALUES(?, 'runtime', ?, 'store', 'C', ?, 'ready', 1, 'valid', NULL)",(name,'hash:'+name,'resources/'+name))
        for task,retention,version in [('active','active',3),('deleted','tombstone',2),('held','hold',0)]:
            payload=json.dumps({'syntheticOpaqueFixture':True,'taskId':task,'originalBytes':'keep\\nthese'},ensure_ascii=False)
            db.execute('INSERT INTO capability_session_snapshots VALUES(?,?,?,?,?,?,?)',(task,version,payload,'hash:'+task,'synthetic-time','created' if version else 'history-unknown',retention))
            db.execute("INSERT INTO capability_session_refs VALUES(?,'runtime','old-resource','hash:old-resource','resources/old-resource')",(task,))
            if version:
                db.execute('INSERT INTO capability_session_identities VALUES(?,?,?,?,?,?,?,?,?)',(task,'codex','/synthetic/codex','native:'+task,'/synthetic/project','/synthetic/home','selection:'+task,'synthetic-time','synthetic-time'))
                db.execute('INSERT INTO capability_session_mcp_names VALUES(?,?,?)',('mcp_'+task,task,'applications'))
        insert_run(db,'old-run','active')
        insert_run(db,'historical-run','active',snapshot='older-unmapped-hash')
        invocation(db,'old-operation','old-run','active')
        db.execute("INSERT INTO capability_run_processes(process_id,run_id,kind,launch_key,state) VALUES('old-process','old-run','cli','launch','exited')")
        db.execute("INSERT INTO capability_run_preparations VALUES('old-run','original-evidence','evidence-hash','synthetic-time')")
        db.execute("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,state,created_at) VALUES('lease','old-resource','run','old-run','host','released','synthetic-time')")
        db.execute("INSERT INTO plugin_write_approvals VALUES('old-operation','approval','old-run','mail','package-hash','write','input-hash','review-hash','policy-hash','allowed','host',123,'host-start','original-provenance',1,2,1)")
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]


def new_binding(db,task='active',name='B',native='claude-native'):
    db.execute('INSERT INTO probe_bindings VALUES(?,?,?,?,?,?,NULL)',(name,task,'claude-code','/synthetic/claude',native,'/synthetic/project'))
    db.execute('INSERT INTO probe_cap_sessions VALUES(?,?,?,?,?,?,?,NULL)',('cap:'+name,name,task,'new-opaque-snapshot','hash:'+name,'active'))
    db.execute("INSERT INTO probe_cap_refs VALUES(?,'new-resource','runtime','hash:new-resource','resources/new-resource')",('cap:'+name,))


class Probe(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='willyou-cap-schema-')
        self.db=sqlite3.connect(Path(self.temp.name)/'test.sqlite')
        baseline=sqlite3.connect(BASE/'baseline.sqlite');baseline.backup(self.db);baseline.close()
        self.db.execute('PRAGMA foreign_keys=ON');seed(self.db)
    def tearDown(self):self.db.close();self.temp.cleanup()
    def table(self,name):return self.db.execute('SELECT * FROM '+name+' ORDER BY rowid').fetchall()
    def migrate(self):return migrate(self.db)
    def test_M01_existing_snapshot_rejects_second_binding(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:self.db.execute("INSERT INTO capability_session_snapshots SELECT * FROM capability_session_snapshots WHERE task_id='active'")
    def test_M02_existing_mcp_kind_is_one_per_task(self):
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:self.db.execute("INSERT INTO capability_session_mcp_names VALUES('other','active','applications')")
    def test_M03_parallel_run_table_cannot_satisfy_business_fk(self):
        self.db.execute('CREATE TABLE shadow_runs(run_id TEXT PRIMARY KEY)');self.db.execute("INSERT INTO shadow_runs VALUES('shadow-run')");self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:invocation(self.db,'new-operation','shadow-run','active')
    def test_M04_original_business_rows_and_snapshots_unchanged(self):
        tables=['capability_session_snapshots','capability_session_refs','capability_session_identities','capability_session_mcp_names','capability_resource_leases','application_invocations','plugin_write_approvals','capability_run_preparations']
        before={t:self.table(t) for t in tables};self.migrate()
        self.assertEqual(before,{t:self.table(t) for t in tables})
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
    def test_M05_new_binding_uses_same_business_run_fk(self):
        self.migrate()
        with self.db:
            new_binding(self.db,task='new-task')
            insert_run(self.db,'new-run','new-task',runner='claude-code',snapshot='hash:B',capability_session_id='cap:B',binding_id='B',execution_mode='programmatic')
            invocation(self.db,'new-operation','new-run','new-task')
        self.assertEqual(self.db.execute("SELECT run_id FROM application_invocations WHERE operation_id='new-operation'").fetchone()[0],'new-run')
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM capability_session_snapshots WHERE task_id='new-task'").fetchone()[0],0)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
    def test_M06_cross_task_or_binding_run_rejected(self):
        self.migrate()
        with self.db:new_binding(self.db)
        for task,binding in [('wrong-task','B'),('active','binding:active')]:
            with self.subTest(task=task,binding=binding):
                with self.assertRaises(sqlite3.IntegrityError):
                    with self.db:insert_run(self.db,'bad',task,capability_session_id='cap:B',binding_id=binding,execution_mode='programmatic')
    def test_M07_backfilled_native_identity_cannot_be_claimed_twice(self):
        self.migrate()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:self.db.execute("INSERT INTO probe_bindings VALUES('duplicate','different-task','codex','/synthetic/codex','native:active','/synthetic/project',NULL)")
    def test_M08_old_gc_reference_query_misses_new_capability_refs(self):
        self.migrate()
        with self.db:new_binding(self.db)
        source=(REPO/'src/main/core/applications/resource-gc-plan.ts').read_text()
        sql='SELECT * FROM capability_session_refs ORDER BY task_id,ref_kind,ref_id'
        self.assertIn(sql,source)
        old=self.db.execute(sql).fetchall()
        self.assertFalse(any(r[2]=='new-resource' for r in old))
        all_refs=self.db.execute('SELECT ref_id FROM capability_session_refs UNION SELECT ref_id FROM probe_cap_refs').fetchall()
        self.assertIn(('new-resource',),all_refs)
    def test_M09_transaction_failure_restores_original_table_and_fks(self):
        schema=self.db.execute("SELECT sql FROM sqlite_master WHERE name='capability_runs'").fetchone()[0]
        old=self.table('capability_runs')
        with self.assertRaises(RuntimeError):migrate(self.db,failpoint='after-drop')
        self.assertEqual(self.table('capability_runs'),old)
        self.assertEqual(self.db.execute("SELECT sql FROM sqlite_master WHERE name='capability_runs'").fetchone()[0],schema)
        self.assertEqual(self.db.execute('PRAGMA foreign_keys').fetchone()[0],1)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE name LIKE 'probe_%'").fetchall(),[])
    def test_M10_repeat_migration_preserves_state(self):
        self.migrate();before='\n'.join(self.db.iterdump())
        self.assertEqual(self.migrate(),'already-migrated')
        self.assertEqual('\n'.join(self.db.iterdump()),before)
    def test_M11_live_unknown_or_leased_state_blocks(self):
        cases=[("UPDATE capability_runs SET state='unknown' WHERE run_id='old-run'","UPDATE capability_runs SET state='stopped' WHERE run_id='old-run'"),
          ("UPDATE capability_run_processes SET state='armed'","UPDATE capability_run_processes SET state='exited'"),
          ("UPDATE capability_resource_leases SET state='active'","UPDATE capability_resource_leases SET state='released'")]
        for start,restore in cases:
            with self.db:self.db.execute(start)
            with self.assertRaises(ValueError):self.migrate()
            with self.db:self.db.execute(restore)
    def test_M12_unmatched_snapshot_and_hold_are_not_guessed(self):
        old=self.table('capability_session_snapshots');self.migrate()
        self.assertEqual(self.table('capability_session_snapshots'),old)
        self.assertEqual(self.db.execute("SELECT capability_session_id,binding_id,execution_mode FROM capability_runs WHERE run_id='historical-run'").fetchone(),(None,None,'legacy'))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM probe_cap_sessions WHERE task_id='held'").fetchone()[0],0)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:insert_run(self.db,'unlinked','active',execution_mode='programmatic')
    def test_M13_tombstone_refs_retain_resources(self):
        self.migrate()
        self.assertEqual(self.db.execute("SELECT retention_state FROM probe_cap_sessions WHERE task_id='deleted'").fetchone()[0],'tombstone')
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:self.db.execute("DELETE FROM capability_resources WHERE resource_id='old-resource'")
        with self.db:new_binding(self.db)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.db:self.db.execute("DELETE FROM capability_resources WHERE resource_id='new-resource'")


class Results(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.rows=[]
    def addSuccess(self,test):super().addSuccess(test);self.rows.append({'id':test._testMethodName,'status':'passed'})
    def addFailure(self,test,error):super().addFailure(test,error);self.rows.append({'id':test._testMethodName,'status':'failed'})
    def addError(self,test,error):super().addError(test,error);self.rows.append({'id':test._testMethodName,'status':'error'})

if __name__=='__main__':
    out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
    with (out/'transcript.txt').open('w') as stream:
        result=unittest.TextTestRunner(stream=stream,verbosity=2,resultclass=Results).run(unittest.defaultTestLoader.loadTestsFromTestCase(Probe))
    report={'scope':'Actual 32 repository DDL files, synthetic data, candidate SQLite migration; NOT production migration runner or runtime authorization',
       'sqlite':sqlite3.sqlite_version,'python':sys.version,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
       'checks':result.testsRun,'successful':result.wasSuccessful(),'results':result.rows}
    (out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (out/'candidate.sql').write_text(NEW_DDL)
    print(json.dumps(report,ensure_ascii=False));sys.exit(0 if result.wasSuccessful() else 1)
