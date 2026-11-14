"""Candidate host delegation semantics, real SQLite and synthetic adapters only."""
from pathlib import Path
import sqlite3,json,hashlib,tempfile,unittest,sys

def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class Host:
 def __init__(self,path):
  self.db=sqlite3.connect(path);self.db.row_factory=sqlite3.Row;self.calls=[]
  self.db.executescript('''
  CREATE TABLE IF NOT EXISTS targets(id TEXT PRIMARY KEY,driver TEXT,rev INTEGER,enabled INTEGER);
  CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,parent TEXT,target TEXT,rev INTEGER,mode TEXT,phase TEXT,owner TEXT,depth INTEGER,generation INTEGER,accept_new INTEGER);
  CREATE TABLE IF NOT EXISTS delegates(id TEXT PRIMARY KEY,parent TEXT,child TEXT UNIQUE,caller TEXT,request TEXT,body_hash TEXT,state TEXT,shared INTEGER,UNIQUE(caller,request));
  CREATE TABLE IF NOT EXISTS delivery(id TEXT PRIMARY KEY,delegation TEXT,revision INTEGER,body TEXT,body_hash TEXT,state TEXT,recipient_target TEXT,recipient_generation INTEGER,UNIQUE(delegation,revision));
  ''')
 def setup(self):
  with self.db:
   self.db.executemany('INSERT INTO targets VALUES(?,?,1,1)',[('codex-A','codex'),('claude-A','claude'),('deepseek-profile','claude'),('future-agent','new-driver')])
   self.db.execute("INSERT INTO tasks VALUES('root',NULL,'codex-A',1,'multi','running','active',0,1,1)")
 def row(self,t,id):return self.db.execute('SELECT * FROM '+t+' WHERE id=?',(id,)).fetchone()
 def delegate(self,request,target,rev=1,parent='root',shared=True,text='work',caller='run-root',max_depth=2,max_children=3):
  body={'parent':parent,'target':target,'rev':rev,'shared':shared,'text':text};h=digest(body)
  with self.db:
   self.db.execute('BEGIN IMMEDIATE');p=self.row('tasks',parent)
   if not p or p['phase']!='running' or p['owner']!='active':raise ValueError('caller-not-live')
   old=self.db.execute('SELECT * FROM delegates WHERE caller=? AND request=?',(caller,request)).fetchone()
   if old:
    if old['body_hash']!=h:raise ValueError('idempotency-conflict')
    return old['id']
   if p['mode']!='multi' or not p['accept_new']:raise ValueError('delegation-disabled')
   if p['depth']>=max_depth:raise ValueError('depth-limit')
   n=self.db.execute('SELECT count(*) FROM delegates WHERE parent=?',(parent,)).fetchone()[0]
   if n>=max_children:raise ValueError('child-limit')
   t=self.row('targets',target)
   if not t or not t['enabled'] or t['rev']!=rev:raise ValueError('target-revision-changed')
   did='d:'+digest([caller,request]);child='child:'+did
   self.db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)',(child,parent,target,rev,'multi','queued','none',p['depth']+1,1,1))
   self.db.execute('INSERT INTO delegates VALUES(?,?,?,?,?,?,?,?)',(did,parent,child,caller,request,h,'queued',int(shared)))
   return did
 def launch(self,did,failpoint=None):
  with self.db:
   self.db.execute('BEGIN IMMEDIATE');d=self.row('delegates',did);c=self.row('tasks',d['child']);p=self.row('tasks',d['parent'])
   if d['state']!='queued':return d['state']
   t=self.row('targets',c['target'])
   if not t or not t['enabled'] or t['rev']!=c['rev']:
    self.db.execute("UPDATE delegates SET state='blocked_target' WHERE id=?",(did,));return 'blocked_target'
   if d['shared'] and p['owner']!='drained':return 'waiting_parent_release'
   # A single directory in this fixture, representing the same canonical workspace.
   if d['shared'] and self.db.execute("SELECT 1 FROM delegates d JOIN tasks t ON t.id=d.child WHERE d.shared=1 AND t.owner IN ('active','unknown')").fetchone():return 'waiting_workspace'
   self.db.execute("UPDATE delegates SET state='dispatching' WHERE id=?",(did,));self.db.execute("UPDATE tasks SET owner='unknown',phase='starting' WHERE id=?",(c['id'],))
  if failpoint=='before-call':return 'dispatching'
  self.calls.append((c['target'],t['driver'],c['rev']))
  if failpoint=='after-call':return 'dispatching'
  with self.db:
   self.db.execute("UPDATE delegates SET state='running' WHERE id=?",(did,));self.db.execute("UPDATE tasks SET phase='running',owner='active' WHERE id=?",(c['id'],))
  return 'running'
 def parent_turn_done(self):
  with self.db:self.db.execute("UPDATE tasks SET phase='idle' WHERE id='root'")
 def drained(self,task):
  # Trusted effect receipt in candidate; actual proof comes from owner subsystem, not MCP args.
  with self.db:self.db.execute("UPDATE tasks SET owner='drained' WHERE id=?",(task,))
 def finish(self,did,body='result',revision=1,generation=1):
  with self.db:
   self.db.execute('BEGIN IMMEDIATE');d=self.row('delegates',did);c=self.row('tasks',d['child'])
   if generation!=c['generation'] or d['state'] in ('canceling','cancelled'):return 'stale'
   old=self.db.execute('SELECT * FROM delivery WHERE delegation=? AND revision=?',(did,revision)).fetchone()
   if old:
    if old['body_hash']!=digest(body):raise ValueError('result-revision-conflict')
    return old['id']
   if d['state'] not in ('running','completed'):raise ValueError('not-running')
   rid='result:'+digest([did,revision]);self.db.execute("INSERT INTO delivery VALUES(?,?,?,?,?,'pending',NULL,NULL)",(rid,did,revision,body,digest(body)))
   self.db.execute("UPDATE delegates SET state='completed' WHERE id=?",(did,));self.db.execute("UPDATE tasks SET phase='idle' WHERE id=?",(c['id'],));return rid
 def claim(self,rid):
  with self.db:
   self.db.execute('BEGIN IMMEDIATE');r=self.row('delivery',rid);d=self.row('delegates',r['delegation']);p=self.row('tasks',d['parent']);c=self.row('tasks',d['child'])
   if r['state']!='pending':return None
   if p['phase']!='idle' or c['owner']!='drained':return None
   self.db.execute("UPDATE delivery SET state='sending',recipient_target=?,recipient_generation=? WHERE id=?",(p['target'],p['generation'],rid));return (p['target'],p['generation'])
 def acknowledge(self,rid,target,generation):
  with self.db:
   r=self.row('delivery',rid)
   if r['state'] not in ('sending','delivered') or (r['recipient_target'],r['recipient_generation'])!=(target,generation):raise ValueError('wrong-delivery-recipient')
   self.db.execute("UPDATE delivery SET state='delivered' WHERE id=?",(rid,))
 def recover(self):
  with self.db:
   self.db.execute("UPDATE delegates SET state='unknown' WHERE state='dispatching'")
   self.db.execute("UPDATE delivery SET state='unknown' WHERE state='sending'")
 def switch(self,target):
  with self.db:
   p=self.row('tasks','root');t=self.row('targets',target)
   if not t or not t['enabled']:raise ValueError('target-unavailable')
   if p['phase']!='idle' or p['owner']!='drained':raise ValueError('parent-busy')
   if self.db.execute("SELECT 1 FROM delivery WHERE state IN ('sending','unknown')").fetchone():raise ValueError('unresolved-delivery')
   self.db.execute("UPDATE tasks SET target=?,rev=?,generation=generation+1 WHERE id='root'",(target,t['rev']))
 def disable_new(self):
  with self.db:self.db.execute("UPDATE tasks SET accept_new=0 WHERE id='root'")
 def finish_single(self):
  with self.db:
   if self.db.execute("SELECT 1 FROM delegates d JOIN tasks t ON t.id=d.child WHERE d.state NOT IN ('completed','cancelled') OR t.owner NOT IN ('none','drained')").fetchone():raise ValueError('children-live')
   if self.db.execute("SELECT 1 FROM delivery WHERE state NOT IN ('delivered','disposed')").fetchone():raise ValueError('results-pending')
   self.db.execute("UPDATE tasks SET mode='single',accept_new=0 WHERE id='root'")
 def cancel(self,did):
  with self.db:
   d=self.row('delegates',did);c=self.row('tasks',d['child'])
   if d['state']=='completed':return 'completed'
   state='cancelled' if c['owner'] in ('none','drained') else 'canceling'
   self.db.execute('UPDATE delegates SET state=? WHERE id=?',(state,did));self.db.execute('UPDATE tasks SET generation=generation+1,accept_new=0 WHERE id=?',(c['id'],));return state
 def aggregate(self):
  if self.db.execute("SELECT 1 FROM delegates WHERE state='unknown' UNION SELECT 1 FROM delivery WHERE state='unknown'").fetchone():return 'recovery_required'
  if self.db.execute("SELECT 1 FROM delegates d JOIN tasks t ON t.id=d.child WHERE d.state NOT IN ('completed','cancelled') OR t.owner NOT IN ('none','drained')").fetchone():return 'waiting_children'
  if self.db.execute("SELECT 1 FROM delivery WHERE state NOT IN ('delivered','disposed')").fetchone():return 'results_pending'
  return 'idle' # not objective-complete; requires parent's own acceptance/finalization

class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'host.sqlite';self.h=Host(self.path);self.h.setup()
 def tearDown(self):self.h.db.close();self.tmp.cleanup()
 def launched(self,**kw):
  d=self.h.delegate('k',kw.pop('target','claude-A'),**kw);self.h.drained('root');self.assertEqual(self.h.launch(d),'running');return d
 def child(self,d):return self.h.row('delegates',d)['child']
 def test_D01_generic_target_matrix(self):
  targets=['codex-A','claude-A','deepseek-profile','future-agent'];pairs=[]
  for parent_target in targets:
   with self.h.db:self.h.db.execute("UPDATE tasks SET target=? WHERE id='root'",(parent_target,))
   for target in targets:
    d=self.h.delegate(parent_target+':'+target,target,shared=False,max_children=16);self.assertEqual(self.h.launch(d),'running');pairs.append((self.h.row('tasks','root')['target'],self.h.calls[-1][0]))
  self.assertEqual(pairs,[(a,b) for a in targets for b in targets])
  self.assertEqual(len(self.h.calls),16)
 def test_D02_creation_receipt_and_conflict(self):
  d=self.h.delegate('same','claude-A');other=Host(self.path)
  try:self.assertEqual(other.delegate('same','claude-A'),d)
  finally:other.db.close()
  with self.assertRaisesRegex(ValueError,'idempotency-conflict'):self.h.delegate('same','deepseek-profile')
  self.assertEqual(self.h.db.execute('SELECT count(*) FROM delegates').fetchone()[0],1)
 def test_D03_receipt_does_not_reresolve_new_target(self):
  d=self.h.delegate('same','claude-A')
  with self.h.db:self.h.db.execute("UPDATE targets SET rev=2 WHERE id='claude-A'")
  self.assertEqual(self.h.delegate('same','claude-A'),d);self.assertEqual(self.h.launch(d),'blocked_target');self.assertEqual(self.h.calls,[])
 def test_D04_stale_selection_rejected_before_creation(self):
  with self.h.db:self.h.db.execute("UPDATE targets SET rev=2 WHERE id='claude-A'")
  with self.assertRaisesRegex(ValueError,'target-revision-changed'):self.h.delegate('same','claude-A')
  self.assertEqual(self.h.db.execute('SELECT count(*) FROM delegates').fetchone()[0],0)
 def test_D05_svn_parent_result_is_not_owner_drain(self):
  d=self.h.delegate('k','claude-A');self.h.parent_turn_done();self.assertEqual(self.h.launch(d),'waiting_parent_release');self.h.drained('root');self.assertEqual(self.h.launch(d),'running')
 def test_D06_shared_sibling_queued_until_exit(self):
  a=self.h.delegate('a','claude-A');b=self.h.delegate('b','deepseek-profile');self.h.drained('root');self.h.launch(a);self.h.finish(a)
  self.assertEqual(self.h.launch(b),'waiting_workspace');self.h.drained(self.child(a));self.assertEqual(self.h.launch(b),'running')
 def test_D07_result_duplicate_and_parent_busy(self):
  d=self.launched();r=self.h.finish(d);self.assertEqual(self.h.finish(d),r);self.h.drained(self.child(d));self.assertIsNone(self.h.claim(r));self.h.parent_turn_done();self.assertEqual(self.h.claim(r),('codex-A',1));self.assertIsNone(self.h.claim(r))
 def test_D08_result_revision_conflict(self):
  d=self.launched();self.h.finish(d)
  with self.assertRaisesRegex(ValueError,'result-revision-conflict'):self.h.finish(d,'different')
 def test_D09_queued_result_follows_parent_switch(self):
  d=self.launched();r=self.h.finish(d);self.h.drained(self.child(d));self.h.parent_turn_done();self.h.switch('deepseek-profile');self.assertEqual(self.h.claim(r),('deepseek-profile',2))
 def test_D10_unconfirmed_delivery_blocks_switch_and_replay(self):
  d=self.launched();r=self.h.finish(d);self.h.drained(self.child(d));self.h.parent_turn_done();self.h.claim(r);self.h.recover();self.assertIsNone(self.h.claim(r))
  with self.assertRaisesRegex(ValueError,'unresolved-delivery'):self.h.switch('deepseek-profile')
  self.assertEqual(self.h.aggregate(),'recovery_required')
 def test_D11_launch_crash_windows_are_not_auto_retried(self):
  for i,point in enumerate(['before-call','after-call']):
   d=self.h.delegate(str(i),'claude-A',shared=False);self.h.launch(d,point);n=len(self.h.calls);self.h.recover();self.assertEqual(self.h.launch(d),'unknown');self.assertEqual(len(self.h.calls),n)
 def test_D12_queued_cancel_and_late_result(self):
  d=self.h.delegate('k','claude-A');self.assertEqual(self.h.cancel(d),'cancelled');self.assertEqual(self.h.launch(d),'cancelled');self.assertEqual(self.h.finish(d),'stale')
 def test_D13_active_cancel_retains_owner(self):
  d=self.launched();self.assertEqual(self.h.cancel(d),'canceling');self.assertEqual(self.h.finish(d),'stale');self.assertEqual(self.h.aggregate(),'waiting_children');self.h.drained(self.child(d));self.assertEqual(self.h.cancel(d),'cancelled')
 def test_D14_mode_disable_blocks_new_but_preserves_results(self):
  d=self.h.delegate('k','claude-A');self.h.disable_new()
  with self.assertRaisesRegex(ValueError,'delegation-disabled'):self.h.delegate('new','claude-A')
  with self.assertRaisesRegex(ValueError,'children-live'):self.h.finish_single()
  self.h.drained('root');self.h.launch(d);r=self.h.finish(d);self.h.drained(self.child(d));self.h.parent_turn_done()
  with self.assertRaisesRegex(ValueError,'results-pending'):self.h.finish_single()
  target,generation=self.h.claim(r);self.h.acknowledge(r,target,generation);self.h.finish_single();self.assertEqual(self.h.row('tasks','root')['mode'],'single')
 def test_D15_host_limits_and_invalid_target(self):
  with self.assertRaisesRegex(ValueError,'depth-limit'):self.h.delegate('a','claude-A',max_depth=0)
  with self.assertRaisesRegex(ValueError,'child-limit'):self.h.delegate('a','claude-A',max_children=0)
  with self.assertRaisesRegex(ValueError,'target-revision-changed'):self.h.delegate('a','missing')
  self.assertEqual(self.h.db.execute('SELECT count(*) FROM delegates').fetchone()[0],0)
 def test_D16_terminal_result_not_tree_completion(self):
  d=self.launched();self.h.parent_turn_done();self.assertEqual(self.h.aggregate(),'waiting_children');r=self.h.finish(d);self.assertEqual(self.h.aggregate(),'waiting_children');self.h.drained(self.child(d));self.assertEqual(self.h.aggregate(),'results_pending');t,g=self.h.claim(r);self.h.acknowledge(r,t,g);self.assertEqual(self.h.aggregate(),'idle')
 def test_D17_wrong_ack_and_finished_cancel(self):
  d=self.launched();r=self.h.finish(d);self.h.drained(self.child(d));self.h.parent_turn_done();self.h.claim(r)
  with self.assertRaisesRegex(ValueError,'wrong-delivery-recipient'):self.h.acknowledge(r,'claude-A',1)
  self.assertEqual(self.h.cancel(d),'completed');self.assertEqual(self.h.row('delivery',r)['state'],'sending')

class Results(unittest.TextTestResult):
 def __init__(self,*a,**k):super().__init__(*a,**k);self.rows=[]
 def addSuccess(self,t):super().addSuccess(t);self.rows.append({'id':t._testMethodName,'status':'passed'})
 def addFailure(self,t,e):super().addFailure(t,e);self.rows.append({'id':t._testMethodName,'status':'failed'})
 def addError(self,t,e):super().addError(t,e);self.rows.append({'id':t._testMethodName,'status':'error'})
if __name__=='__main__':
 out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=False)
 with (out/'transcript.txt').open('w') as stream:r=unittest.TextTestRunner(stream=stream,verbosity=2,resultclass=Results).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 (out/'result.json').write_text(json.dumps({'scope':'Candidate host semantics only; real SQLite, synthetic adapter dispatch. Not T3 execution or WillYou production orchestration, not real SDK delegation or OS workspace isolation.','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'sqlite':sqlite3.sqlite_version,'successful':r.wasSuccessful(),'results':r.rows},indent=2)+'\n')
 print('passed',r.wasSuccessful(),'tests',r.testsRun);sys.exit(0 if r.wasSuccessful() else 1)
