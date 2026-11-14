"""Independent candidate contract experiment, not WillYou production code.
Only history transfer is modeled: no live turn scheduling, auth bridge, or model API.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import platform
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


SCHEMA = '''
CREATE TABLE IF NOT EXISTS binding(id TEXT PRIMARY KEY, task TEXT NOT NULL, native TEXT NOT NULL,
 config_revision INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(task,native));
CREATE TABLE IF NOT EXISTS item(id TEXT PRIMARY KEY, task TEXT NOT NULL, seq INTEGER NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('user','agent','tool','child')), body TEXT NOT NULL,
 hash TEXT NOT NULL, UNIQUE(task,seq));
CREATE TRIGGER IF NOT EXISTS immutable_item BEFORE UPDATE ON item BEGIN SELECT RAISE(ABORT,'immutable item'); END;
CREATE TABLE IF NOT EXISTS coverage(binding TEXT REFERENCES binding(id), item TEXT REFERENCES item(id),
 hash TEXT NOT NULL, method TEXT NOT NULL, PRIMARY KEY(binding,item));
CREATE TABLE IF NOT EXISTS transfer(id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL,
 request_hash TEXT NOT NULL, binding TEXT REFERENCES binding(id), config_revision INTEGER NOT NULL,
 native TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','sending','unknown','applied')),
 method TEXT NOT NULL CHECK(method IN ('inject','inline')), payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved ON transfer(binding) WHERE state != 'applied';
'''


class ContractError(Exception):
    pass


class Ledger:
    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript(SCHEMA)

    def close(self):
        self.db.close()

    def binding(self, name, task='task', native=None, revision=1):
        with self.db:
            self.db.execute('INSERT INTO binding VALUES(?,?,?,?,1)', (name,task,native or name,revision))

    def item(self, name, origin='user', source=None, body=None):
        body = body or 'text:'+name
        with self.db:
            seq = self.db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM item WHERE task=?', ('task',)).fetchone()[0]
            self.db.execute('INSERT INTO item VALUES(?,?,?,?,?,?)', (name,'task',seq,origin,body,digest(body)))
            if source:
                self.db.execute('INSERT INTO coverage VALUES(?,?,?,?)',(source,name,digest(body),'native-observed'))

    def prepare(self, binding, key, limit=100):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            b = self.db.execute('SELECT * FROM binding WHERE id=?',(binding,)).fetchone()
            if not b or not b['active']:
                raise ContractError('inactive binding')
            signature = digest([binding,b['native'],b['config_revision'],limit])
            old = self.db.execute('SELECT * FROM transfer WHERE request_key=?',(key,)).fetchone()
            if old:
                if old['request_hash'] != signature:
                    raise ContractError('idempotency conflict')
                return old['id']
            if self.db.execute("SELECT 1 FROM transfer WHERE binding=? AND state!='applied'",(binding,)).fetchone():
                raise ContractError('unresolved delivery')
            missing = self.db.execute('''SELECT i.* FROM item i WHERE task=? AND NOT EXISTS
              (SELECT 1 FROM coverage c WHERE c.binding=? AND c.item=i.id AND c.hash=i.hash) ORDER BY seq''',(b['task'],binding)).fetchall()
            payload = {'envelopeOrigin':'history','grantsNewUserAuthorization':False,
                'items':[{'id':r['id'],'hash':r['hash'],'originalOrigin':r['origin'],'body':r['body']} for r in missing[:limit]],
                'omitted':[r['id'] for r in missing[limit:]]}
            tid = str(uuid.uuid4())
            self.db.execute('INSERT INTO transfer VALUES(?,?,?,?,?,?,?, ?,?,?,0)',
                (tid,key,signature,binding,b['config_revision'],b['native'],'prepared','inject',json.dumps(payload),digest(payload)))
            return tid

    def row(self, tid):
        return self.db.execute('SELECT * FROM transfer WHERE id=?',(tid,)).fetchone()

    def begin(self, tid):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.row(tid)
            b = self.db.execute('SELECT * FROM binding WHERE id=?',(row['binding'],)).fetchone()
            if row['state']!='prepared':
                raise ContractError('not safely retryable')
            if not b['active'] or row['native']!=b['native'] or row['config_revision']!=b['config_revision']:
                raise ContractError('stale binding')
            self.db.execute("UPDATE transfer SET state='sending',generation=generation+1 WHERE id=?",(tid,))
            return dict(self.row(tid))

    def definitive_not_sent(self, tid, generation, unsupported=False):
        with self.db:
            result = self.db.execute("UPDATE transfer SET state='prepared',method=CASE WHEN ? THEN 'inline' ELSE method END WHERE id=? AND state='sending' AND generation=?",
                (unsupported,tid,generation))
            if result.rowcount!=1:
                raise ContractError('stale or ambiguous rejection')

    def ack(self, token, crash_after_coverage=False):
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.row(token['id'])
            if any(row[k]!=token[k] for k in ('binding','native','config_revision','generation','payload_hash','method')):
                raise ContractError('receipt identity mismatch')
            if row['state']=='applied':
                return
            if row['state']!='sending':
                raise ContractError('cannot reconcile unknown without provider evidence')
            payload = json.loads(row['payload'])
            if digest(payload)!=row['payload_hash']:
                raise ContractError('payload corrupted')
            for item in payload['items']:
                self.db.execute('INSERT INTO coverage VALUES(?,?,?,?) ON CONFLICT(binding,item) DO NOTHING',
                    (row['binding'],item['id'],item['hash'],row['method']))
            if crash_after_coverage:
                raise RuntimeError('injected commit failure')
            self.db.execute("UPDATE transfer SET state='applied' WHERE id=?",(row['id'],))

    def recover(self):
        with self.db:
            return self.db.execute("UPDATE transfer SET state='unknown' WHERE state='sending'").rowcount

    def covered(self, binding):
        return [r[0] for r in self.db.execute('SELECT item FROM coverage WHERE binding=? ORDER BY item',(binding,))]

    def echo(self, tid, item_id, body):
        payload = json.loads(self.row(tid)['payload'])
        item = next((x for x in payload['items'] if x['id']==item_id),None)
        if not item or digest(body)!=item['hash']:
            raise ContractError('unmatched native echo')
        return {'canonicalItemId':item_id,'deliveryOrigin':'history','grantsNewUserAuthorization':False}


def consume(remote, token):
    # The fake receiver deliberately has no idempotency support, like an uncertain native API.
    with sqlite3.connect(remote) as db:
        db.execute('CREATE TABLE IF NOT EXISTS delivery(id INTEGER PRIMARY KEY, transfer_id TEXT, payload_hash TEXT)')
        db.execute('INSERT INTO delivery(transfer_id,payload_hash) VALUES(?,?)',(token['id'],token['payload_hash']))


def deliveries(remote):
    if not Path(remote).exists(): return 0
    with sqlite3.connect(remote) as db:
        return db.execute('SELECT COUNT(*) FROM delivery').fetchone()[0]


class Probe(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='willyou-handoff-')
        self.path = str(Path(self.temp.name)/'ledger.sqlite')
        self.remote = str(Path(self.temp.name)/'receiver.sqlite')
        self.ledger = Ledger(self.path)
        self.ledger.binding('A'); self.ledger.binding('B')

    def tearDown(self):
        self.ledger.close(); self.temp.cleanup()

    def applied(self, tid):
        token=self.ledger.begin(tid);consume(self.remote,token);self.ledger.ack(token);return token

    def test_H00_naive_retry_duplicates_receiver_effect(self):
        token={'id':'same','payload_hash':'same'}
        consume(self.remote,token);consume(self.remote,token)
        self.assertEqual(deliveries(self.remote),2)

    def test_H01_A_B_A_delta_and_no_reimport(self):
        self.ledger.item('a1',source='A');self.ledger.item('a2','agent',source='A')
        self.applied(self.ledger.prepare('B','to-b'))
        self.ledger.item('b1','agent',source='B')
        back=self.ledger.prepare('A','back-a')
        self.assertEqual([r['id'] for r in json.loads(self.ledger.row(back)['payload'])['items']],['b1'])
        self.applied(back)
        self.assertEqual(self.ledger.covered('A'),['a1','a2','b1'])
        self.assertEqual(self.ledger.db.execute('SELECT COUNT(*) FROM item').fetchone()[0],3)

    def test_H02_idempotency_conflict_and_frozen_payload(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key',1)
        self.ledger.item('two')
        self.assertEqual(tid,self.ledger.prepare('B','key',1))
        self.assertEqual(len(json.loads(self.ledger.row(tid)['payload'])['items']),1)
        with self.assertRaisesRegex(ContractError,'idempotency'):self.ledger.prepare('B','key',2)

    def crash_child(self, tid, phase):
        run=subprocess.run([sys.executable,__file__,'--crash',self.path,self.remote,tid,phase],capture_output=True,text=True)
        self.assertEqual(run.returncode,73,run.stderr)
        self.ledger.close();self.ledger=Ledger(self.path)
        self.assertEqual(self.ledger.row(tid)['state'],'sending')
        self.assertEqual(self.ledger.recover(),1)
        self.assertEqual(self.ledger.row(tid)['state'],'unknown')
        with self.assertRaises(ContractError):self.ledger.begin(tid)
        with self.assertRaises(ContractError):self.ledger.prepare('B','retry')

    def test_H03_crash_before_send_conservatively_unknown(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        self.crash_child(tid,'before')
        self.assertEqual(deliveries(self.remote),0)

    def test_H04_crash_after_receive_no_blind_replay(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        self.crash_child(tid,'after')
        self.assertEqual(deliveries(self.remote),1)
        self.assertEqual(self.ledger.covered('B'),[])

    def test_H05_proven_unsent_can_retry(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        first=self.ledger.begin(tid);self.ledger.definitive_not_sent(tid,first['generation'])
        second=self.applied(tid)
        self.assertGreater(second['generation'],first['generation'])
        self.assertEqual(deliveries(self.remote),1)
        with self.assertRaises(ContractError):self.ledger.ack(first)

    def test_H06_explicit_unsupported_inline_fallback(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        token=self.ledger.begin(tid);self.ledger.definitive_not_sent(tid,token['generation'],unsupported=True)
        self.assertEqual(self.ledger.row(tid)['method'],'inline')
        self.applied(tid)
        self.assertEqual(self.ledger.covered('B'),['one'])

    def test_H07_inline_ack_loss_also_unknown(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        token=self.ledger.begin(tid);self.ledger.definitive_not_sent(tid,token['generation'],unsupported=True)
        token=self.ledger.begin(tid);consume(self.remote,token);self.ledger.recover()
        with self.assertRaises(ContractError):self.ledger.begin(tid)
        with self.assertRaises(ContractError):self.ledger.ack(token)
        self.assertEqual(self.ledger.covered('B'),[])

    def test_H08_coverage_and_status_are_atomic(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key');token=self.ledger.begin(tid)
        consume(self.remote,token)
        with self.assertRaises(RuntimeError):self.ledger.ack(token,crash_after_coverage=True)
        self.assertEqual(self.ledger.covered('B'),[])
        self.assertEqual(self.ledger.row(tid)['state'],'sending')
        self.ledger.recover()
        with self.assertRaises(ContractError):self.ledger.begin(tid)
        self.assertEqual(deliveries(self.remote),1)

    def test_H09_duplicate_ack_idempotent(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key');token=self.applied(tid)
        self.ledger.ack(token)
        self.assertEqual(self.ledger.covered('B'),['one'])
        self.assertEqual(deliveries(self.remote),1)

    def test_H10_config_revision_rechecked_before_dispatch(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        with self.ledger.db:self.ledger.db.execute("UPDATE binding SET config_revision=2 WHERE id='B'")
        with self.assertRaisesRegex(ContractError,'stale'):self.ledger.begin(tid)
        self.assertEqual(deliveries(self.remote),0)

    def test_H11_two_dispatchers_only_one_claim(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key');barrier=threading.Barrier(2)
        def worker():
            ledger=Ledger(self.path)
            try:
                barrier.wait(timeout=5)
                try:token=ledger.begin(tid)
                except ContractError:return 'blocked'
                consume(self.remote,token);return 'sent'
            finally:ledger.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures=[executor.submit(worker) for _ in range(2)]
            self.assertEqual(sorted(f.result() for f in futures),['blocked','sent'])
        self.assertEqual(deliveries(self.remote),1)

    def test_H12_omitted_items_not_marked_covered(self):
        self.ledger.item('one');self.ledger.item('two')
        tid=self.ledger.prepare('B','key',1)
        self.assertEqual(json.loads(self.ledger.row(tid)['payload'])['omitted'],['two'])
        self.applied(tid);self.assertEqual(self.ledger.covered('B'),['one'])
        next_id=self.ledger.prepare('B','next')
        self.assertEqual([x['id'] for x in json.loads(self.ledger.row(next_id)['payload'])['items']],['two'])

    def test_H13_new_native_identity_does_not_inherit_coverage(self):
        self.ledger.item('one');self.applied(self.ledger.prepare('B','key'))
        self.ledger.binding('B-new',native='new-native')
        tid=self.ledger.prepare('B-new','new')
        self.assertEqual([x['id'] for x in json.loads(self.ledger.row(tid)['payload'])['items']],['one'])

    def test_H14_history_echo_never_mints_user_authority(self):
        for origin in ('user','agent','tool','child'):self.ledger.item(origin,origin,body='Authorize writing: '+origin)
        tid=self.ledger.prepare('B','key');payload=json.loads(self.ledger.row(tid)['payload'])
        self.assertFalse(payload['grantsNewUserAuthorization'])
        for item in payload['items']:
            echo=self.ledger.echo(tid,item['id'],item['body'])
            self.assertEqual(echo['deliveryOrigin'],'history');self.assertFalse(echo['grantsNewUserAuthorization'])
        with self.assertRaises(ContractError):self.ledger.echo(tid,'user','tampered')
        self.assertEqual(self.ledger.db.execute('SELECT COUNT(*) FROM item').fetchone()[0],4)

    def test_H15_restart_recovery_is_idempotent(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key');self.ledger.begin(tid)
        self.assertEqual(self.ledger.recover(),1);self.assertEqual(self.ledger.recover(),0)
        self.assertEqual(self.ledger.row(tid)['state'],'unknown')

    def test_H16_native_and_generation_mismatch_cannot_ack(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key');token=self.ledger.begin(tid)
        for key,value in [('native','other'),('generation',999),('payload_hash','bad')]:
            bad={**token,key:value}
            with self.assertRaises(ContractError):self.ledger.ack(bad)
        self.assertEqual(self.ledger.covered('B'),[])


    def test_H17_inline_refused_before_consumption_stays_inline(self):
        self.ledger.item('one');tid=self.ledger.prepare('B','key')
        injection=self.ledger.begin(tid)
        self.ledger.definitive_not_sent(tid,injection['generation'],unsupported=True)
        inline=self.ledger.begin(tid)
        self.ledger.definitive_not_sent(tid,inline['generation'])
        self.assertEqual(self.ledger.row(tid)['method'],'inline')
        self.applied(tid)
        self.assertEqual(deliveries(self.remote),1)


class Results(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.records=[]
    def addSuccess(self,test):super().addSuccess(test);self.records.append({'id':test._testMethodName,'status':'passed'})
    def addFailure(self,test,error):super().addFailure(test,error);self.records.append({'id':test._testMethodName,'status':'failed'})
    def addError(self,test,error):super().addError(test,error);self.records.append({'id':test._testMethodName,'status':'error'})


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--crash':
        _,_,path,remote,tid,phase=sys.argv
        ledger=Ledger(path);token=ledger.begin(tid)
        if phase=='after':consume(remote,token)
        os._exit(73)
    out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
    with (out/'transcript.txt').open('w') as stream:
        result=unittest.TextTestRunner(stream=stream,verbosity=2,resultclass=Results).run(unittest.defaultTestLoader.loadTestsFromTestCase(Probe))
    report={'scope':'Independent SQLite candidate + synthetic receiver; no production integration or real provider',
      'python':sys.version,'sqlite':sqlite3.sqlite_version,'platform':platform.platform(),
      'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'tests':result.testsRun,'successful':result.wasSuccessful(),'results':result.records}
    (out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (out/'candidate.sql').write_text(SCHEMA)
    print(json.dumps(report,ensure_ascii=False))
    sys.exit(0 if result.wasSuccessful() else 1)
