from pathlib import Path
import sqlite3,json,re,hashlib,os,subprocess,tempfile
root=Path(__file__).parent
repo=Path('/Users/hx/projects/SmartDD')
out=root/'storage-a1';out.mkdir(exist_ok=True)
results=[]
def check(name,fn):
 try:
  detail=fn();results.append({'id':name,'status':'passed','detail':detail})
 except Exception as e:results.append({'id':name,'status':'failed','error':repr(e)})
 (out/'result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 print(name,results[-1]['status'])
def need(value):
 if not value:raise AssertionError('predicate false')
def rejected(fn):
 try:fn()
 except sqlite3.IntegrityError:return
 raise AssertionError('constraint did not reject')
oldsql=re.search(r'```sql\n(.*?)```',(repo/'docs/统一Agent工作区优化方案.md').read_text(),re.S).group(1)
db=sqlite3.connect(out/'old-design.sqlite',isolation_level=None)
db.execute('PRAGMA foreign_keys=ON')
db.executescript('CREATE TABLE tasks(id TEXT PRIMARY KEY);CREATE TABLE capability_runs(run_id TEXT PRIMARY KEY);')
db.executescript(oldsql)
db.execute("INSERT INTO tasks VALUES('t')");db.execute("INSERT INTO capability_runs VALUES('r')")
db.execute("INSERT INTO agent_sessions(task_id,runtime_kind,state,config_snapshot_json,created_at,updated_at) VALUES('t','claude-sdk','ready','{}',0,0)")
def old_single():
 rejected(lambda:db.execute("INSERT INTO agent_sessions(task_id,runtime_kind,state,config_snapshot_json,created_at,updated_at) VALUES('t','codex-app-server','ready','{}',0,0)"))
 return 'Actual SQL from R0.2 rejects second runtime row for same task; confirms redesign is required.'
check('P01-old-design-single-binding-counterexample',old_single)
def old_unknown():
 db.execute("INSERT INTO agent_turns(turn_id,task_id,run_id,generation,client_message_id,submission_digest,input_json,state,created_at) VALUES('a','t','r',1,'m1','h','[]','unknown',0)")
 rejected(lambda:db.execute("INSERT INTO agent_turns(turn_id,task_id,run_id,generation,client_message_id,submission_digest,input_json,state,created_at) VALUES('b','t','r',1,'m2','h','[]','queued',0)"))
 return 'Unknown turn keeps exclusive task slot.'
check('P02-existing-DDL-unknown-exclusion',old_unknown)
def old_deletion():
 db.execute("INSERT INTO agent_restore_ops(operation_id,task_id,plan_digest,plan_json,state,created_at,updated_at) VALUES('restore','t','h','{}','unknown',0,0)")
 rejected(lambda:db.execute("DELETE FROM tasks WHERE id='t'"))
 need(db.execute('SELECT count(*) FROM tasks').fetchone()[0]==1)
 return 'Foreign key prevents task deletion during unresolved restore.'
check('P03-existing-DDL-delete-protection',old_deletion)
new=sqlite3.connect(out/'candidate.sqlite',isolation_level=None);new.execute('PRAGMA foreign_keys=ON');new.execute('PRAGMA journal_mode=WAL')
candidate='''CREATE TABLE tasks(id TEXT PRIMARY KEY,legacy_json TEXT NOT NULL,active_binding TEXT,generation INTEGER NOT NULL DEFAULT 0,draft_rev INTEGER NOT NULL DEFAULT 0,draft TEXT NOT NULL DEFAULT '');
CREATE TABLE bindings(id TEXT PRIMARY KEY,task TEXT NOT NULL REFERENCES tasks(id),runtime TEXT NOT NULL,profile_revision TEXT NOT NULL,state_root TEXT NOT NULL,native_id TEXT,capability_session TEXT NOT NULL UNIQUE,UNIQUE(runtime,state_root,native_id));
CREATE TABLE transfers(id TEXT PRIMARY KEY,binding TEXT NOT NULL REFERENCES bindings(id),item TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','delivered','unknown')),UNIQUE(binding,item));
CREATE TABLE delegates(id TEXT PRIMARY KEY,parent TEXT NOT NULL REFERENCES tasks(id),request TEXT NOT NULL,digest TEXT NOT NULL,child TEXT NOT NULL REFERENCES tasks(id),state TEXT NOT NULL,UNIQUE(parent,request));
CREATE TABLE deliveries(delegation TEXT NOT NULL REFERENCES delegates(id),version INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind='child-result'),state TEXT NOT NULL,PRIMARY KEY(delegation,version));
CREATE TABLE events(task TEXT NOT NULL REFERENCES tasks(id),seq INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(task,seq));
CREATE TABLE items(task TEXT NOT NULL REFERENCES tasks(id),item TEXT NOT NULL,ordinal INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(task,item),UNIQUE(task,ordinal));
CREATE TABLE templates(id TEXT NOT NULL,rev INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,rev));
CREATE TABLE template_applications(task TEXT PRIMARY KEY REFERENCES tasks(id),template TEXT NOT NULL,revision INTEGER NOT NULL,resolved TEXT NOT NULL,FOREIGN KEY(template,revision) REFERENCES templates(id,rev));'''
(out/'candidate.sql').write_text(candidate);new.executescript(candidate)
legacy=json.dumps({'runner':'claude-code','nativeSessionId':'native-A','scope':['mail'],'cwd':'/fixture'})
new.execute('INSERT INTO tasks(id,legacy_json) VALUES(?,?)',('t',legacy))
def migration():
 for _ in range(2):new.execute('INSERT OR IGNORE INTO bindings VALUES(?,?,?,?,?,?,?)',('a','t','claude','profile-a/1','/root-a','native-A','caps-a'))
 need(new.execute('SELECT count(*) FROM bindings').fetchone()[0]==1)
 need(new.execute('SELECT legacy_json FROM tasks').fetchone()[0]==legacy)
 new.execute('INSERT INTO bindings VALUES(?,?,?,?,?,?,?)',('b','t','codex','profile-b/1','/root-b','native-B','caps-b'))
 for bid in ['a','b','a']:new.execute('UPDATE tasks SET active_binding=?,generation=generation+1 WHERE id=?',(bid,'t'))
 need(new.execute('SELECT active_binding,generation FROM tasks').fetchone()==('a',3))
 return 'Candidate additive migration reruns and A→B→A preserve task and original snapshot bytes; not production migration.'
check('P04-candidate-multibinding-idempotence',migration)
def ownership():
 new.execute("INSERT INTO tasks(id,legacy_json) VALUES('other','{}')")
 rejected(lambda:new.execute("INSERT INTO bindings VALUES('evil','other','claude','profile-x','/root-a','native-A','caps-x')"))
 return 'Same native identity cannot be assigned to another logical task.'
check('P05-candidate-native-ownership',ownership)
def rollback():
 before=list(new.execute('SELECT * FROM tasks'))
 try:
  new.execute('BEGIN IMMEDIATE');new.execute("UPDATE tasks SET active_binding='b' WHERE id='t'");new.execute("INSERT INTO bindings VALUES('bad','missing','claude','p','/c','n','caps')");new.execute('COMMIT')
 except sqlite3.IntegrityError:new.execute('ROLLBACK')
 need(list(new.execute('SELECT * FROM tasks'))==before)
 return 'Injected foreign-key failure rolls back active pointer and leaves no partial binding.'
check('P06-candidate-switch-transaction-failure',rollback)
def draft():
 a=new.execute("UPDATE tasks SET draft='new',draft_rev=draft_rev+1 WHERE id='t' AND draft_rev=0").rowcount
 b=new.execute("UPDATE tasks SET draft='old',draft_rev=draft_rev+1 WHERE id='t' AND draft_rev=0").rowcount
 need((a,b)==(1,0));need(new.execute("SELECT draft FROM tasks WHERE id='t'").fetchone()[0]=='new')
 return 'CAS prevents old-window draft save from overwriting newer draft.'
check('P07-draft-compare-and-set',draft)
def template():
 body={'roles':{'lead':'profile-a','review':'profile-b'},'steps':[{'id':'implement','role':'lead'},{'id':'review','role':'review','after':['implement']}],'acceptance':'review evidence','allowed':['profile-a','profile-b'],'maxChildren':2}
 new.execute('INSERT INTO templates VALUES(?,?,?)',('team',1,json.dumps(body)))
 new.execute('INSERT INTO template_applications VALUES(?,?,?,?)',('t','team',1,json.dumps(body)))
 body['roles']={'lead':'profile-b','review':'profile-a'}
 new.execute('INSERT INTO templates VALUES(?,?,?)',('team',2,json.dumps(body)))
 fresh=sqlite3.connect(out/'candidate.sqlite');old=json.loads(fresh.execute("SELECT resolved FROM template_applications WHERE task='t'").fetchone()[0]);latest=json.loads(fresh.execute("SELECT body FROM templates WHERE rev=2").fetchone()[0]);fresh.close()
 need(old['roles']['lead']=='profile-a' and latest['roles']['lead']=='profile-b');need('key' not in json.dumps(old).lower())
 return 'Persisted role swap affects new revision; prior task keeps adopted revision across reopen; config deletion validation still needs service.'
check('P08-template-revision-reopen',template)
def delegation():
 new.execute("INSERT INTO tasks(id,legacy_json) VALUES('child','{}')");new.execute("INSERT INTO delegates VALUES('d','t','req1','digest','child','working')")
 rejected(lambda:new.execute("INSERT INTO delegates VALUES('d2','t','req1','digest','child','working')"))
 new.execute("INSERT INTO deliveries VALUES('d',1,'child-result','queued')")
 rejected(lambda:new.execute("INSERT INTO deliveries VALUES('d',1,'child-result','queued')"))
 rejected(lambda:new.execute("INSERT INTO deliveries VALUES('d',2,'human-user','queued')"))
 return 'Candidate unique keys protect delegation and result enqueue; delivery cannot claim human origin. No runtime scheduler proven.'
check('P09-delegation-idempotence-origin',delegation)
def replay():
 for i in range(1,10001):
  new.execute('INSERT INTO items VALUES(?,?,?,?)',('t',f'i{i}',i,f'body{i}'))
  new.execute('INSERT INTO events VALUES(?,?,?)',('t',i,f'event{i}'))
 new.execute("DELETE FROM events WHERE seq<=9000")
 rows=[];cursor=10001
 while True:
  page=list(new.execute('SELECT ordinal FROM items WHERE task=? AND ordinal<? ORDER BY ordinal DESC LIMIT 50',('t',cursor)))
  if not page:break
  rows += [x[0] for x in page];cursor=page[-1][0]
 need(rows==list(range(10000,0,-1)));need(new.execute('SELECT min(seq) FROM events').fetchone()[0]==9001)
 plan=list(new.execute("EXPLAIN QUERY PLAN SELECT ordinal FROM items WHERE task='t' AND ordinal<5000 ORDER BY ordinal DESC LIMIT 50"))
 return {'pages':200,'all_items_retained':True,'query_plan':plan,'not_proven':'IPC snapshot atomicity, renderer anchoring and heap'}
check('P10-history-pagination-after-event-prune',replay)
def target_publish():
 src=out/'source.jsonl';src.write_bytes(b'original\r\n');target=out/'target.jsonl';target.write_bytes(b'user-existing\n');stage=out/'stage.jsonl';stage.write_bytes(src.read_bytes())
 try:os.link(stage,target)
 except FileExistsError:pass
 else:raise AssertionError('overwrote target')
 need(src.read_bytes()==b'original\r\n' and target.read_bytes()==b'user-existing\n')
 return 'No-replace link publication preserves competing target; full native subsidiary history still unproven.'
check('P11-history-publication-no-replace',target_publish)
def svn():
 rep=out/'svn-repo';wc=out/'wc';subprocess.run(['/opt/homebrew/bin/svnadmin','create',str(rep)],check=True,capture_output=True)
 subprocess.run(['/opt/homebrew/bin/svn','checkout','--non-interactive',rep.as_uri(),str(wc)],check=True,capture_output=True)
 (wc/'nested').mkdir();alias=out/'wc-alias';alias.symlink_to(wc,target_is_directory=True)
 with (wc/'large.bin').open('wb') as f:f.truncate(11*1024**3)
 stats=(wc/'large.bin').stat();(out/'svn-fixture.json').write_text(json.dumps({'wc':str(wc),'alias':str(alias),'logical_bytes':stats.st_size,'allocated_bytes':stats.st_blocks*512,'synthetic_sparse':True},indent=2))
 need(not (wc/'.git').exists());return {'logical_bytes':stats.st_size,'allocated_bytes':stats.st_blocks*512,'boundary':'Sparse fixture tests metadata paths, NOT representative real-project performance.'}
check('P12-real-local-SVN-large-sparse-fixture',svn)
db.close();new.close()
