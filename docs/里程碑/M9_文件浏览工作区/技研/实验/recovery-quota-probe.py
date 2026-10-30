#!/usr/bin/env python3
"""Freeze conservative recovery accounting defaults with real synthetic files.
Registry/concurrency prototype only; no production broker or real full-disk test.
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import pathlib
import shutil
import sqlite3
import tempfile
import time

HERE = pathlib.Path(__file__).resolve(); MiB = 1024**2
POLICY = {'projectBytes': 512*MiB, 'globalBytes': 2048*MiB, 'metadataReserveBytes': 64*1024,
          'resolvedRetentionDays': 7, 'maxResolvedPerDocument': 2,
          'unresolvedExpiry': None, 'spaceHeadroomBytes': 128*MiB}
spec=importlib.util.spec_from_file_location('journal', HERE.with_name('save-recovery-probe.py'))
journal=importlib.util.module_from_spec(spec); spec.loader.exec_module(journal)

def reserve(db, op, project, source_bytes, candidate_bytes):
    # Old inode + immutable draft + new target staging. Logical sizes are counted
    # conservatively, even when APFS happens to share physical extents.
    required=source_bytes+2*candidate_bytes+POLICY['metadataReserveBytes']
    with sqlite3.connect(db, timeout=5) as c:
        c.execute('BEGIN IMMEDIATE')
        prior=c.execute('SELECT project,bytes FROM reservations WHERE op=?',(op,)).fetchone()
        if prior:
            if prior!=(project,required): raise ValueError('opId payload changed')
            return True
        total,local=c.execute('SELECT coalesce(sum(bytes),0),coalesce(sum(CASE WHEN project=? THEN bytes ELSE 0 END),0) FROM reservations',(project,)).fetchone()
        if local+required>POLICY['projectBytes'] or total+required>POLICY['globalBytes']:return False
        c.execute('INSERT INTO reservations VALUES(?,?,?)',(op,project,required)); return True

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);args=ap.parse_args()
    report={'revision':'R3.4','policy':POLICY,'scriptSha256':hashlib.sha256(HERE.read_bytes()).hexdigest(),
            'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cases':[]}
    def case(cid,title,fn):
        try: evidence=fn();status='passed'
        except Exception as e:evidence={'error':repr(e)};status='failed'
        report['cases'].append({'id':cid,'title':title,'status':status,'evidence':evidence})
    with tempfile.TemporaryDirectory(prefix='m9-quota-') as tmp:
        root=pathlib.Path(tmp);db=root/'accounting.sqlite'
        with sqlite3.connect(db) as c:c.execute('CREATE TABLE reservations(op TEXT PRIMARY KEY, project TEXT, bytes INTEGER)')
        def sizing(size):
            assert shutil.disk_usage(root).free>size*3+POLICY['spaceHeadroomBytes']
            p=root/str(size);p.mkdir();target=p/'file.bin';target.write_bytes(b'B'*size)
            start=time.monotonic();r=journal.journal_save(p,'file.bin',b'D'*size,hashlib.sha256(b'B'*size).hexdigest())
            assert r['status']=='saved'
            actual=sum(x.stat().st_size for x in p.rglob('*') if x.is_file())
            reserved=size*3+POLICY['metadataReserveBytes']
            assert actual<=reserved
            return {'sourceBytes':size,'actualLogicalBytes':actual,'reservationBytes':reserved,
                    'journalSaveMs':round((time.monotonic()-start)*1000,2),'included':'target+displaced+draft+prepared JSON',
                    'notMeasured':'filesystem metadata/APFS extents/power-loss'}
        case('RQ01','10MiB可编辑文本的真实三版本与日志尺寸',lambda:sizing(10*MiB))
        case('RQ02','40MiB Office上界样本的真实三版本与日志尺寸',lambda:sizing(40*MiB))
        def concurrent_limit():
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
                accepted=list(pool.map(lambda n:reserve(db,'large-'+str(n),'project-a',40*MiB,40*MiB),range(5)))
            assert sum(accepted)==4
            with sqlite3.connect(db) as c:used=c.execute('SELECT sum(bytes) FROM reservations').fetchone()[0]
            assert used<=POLICY['projectBytes']
            return {'accepted':sum(accepted),'rejected':5-sum(accepted),'reservedBytes':used,'concurrentConnections':5}
        case('RQ03','五个并发大文件预约只能四个成功，不超512MiB项目配额',concurrent_limit)
        def idempotent():
            with sqlite3.connect(db) as c:op=c.execute('SELECT op FROM reservations LIMIT 1').fetchone()[0];before=c.execute('SELECT sum(bytes) FROM reservations').fetchone()[0]
            assert reserve(db,op,'project-a',40*MiB,40*MiB)
            try:reserve(db,op,'project-a',1,1);raise AssertionError('changed payload accepted')
            except ValueError:pass
            with sqlite3.connect(db) as c:after=c.execute('SELECT sum(bytes) FROM reservations').fetchone()[0]
            assert before==after;return {'repeatedOpDoesNotReserveTwice':True,'changedPayloadRejected':True}
        case('RQ04','opId幂等且重用不同尺寸请求拒绝',idempotent)
        def refusal():
            target=root/'untouched.txt';target.write_bytes(b'ORIGINAL');before=target.read_bytes()
            accepted=reserve(db,'rejected-target','project-a',40*MiB,40*MiB)
            if accepted:target.write_bytes(b'INCORRECT')
            assert not accepted and target.read_bytes()==before
            return {'quotaRefusalBeforeAnyTargetWrite':True,'callerMustKeepMemoryDraft':True,'realENOSPC':'not-tested'}
        case('RQ05','配额拒绝在目标写入前，原件不变；不假称真实满盘',refusal)
        def global_limit():
            count=0
            for project in ['b','c','d','e','f']:
                for n in range(4):count+=reserve(db,project+str(n),project,40*MiB,40*MiB)
            with sqlite3.connect(db) as c:used=c.execute('SELECT sum(bytes) FROM reservations').fetchone()[0]
            assert used<=POLICY['globalBytes'] and count==13
            return {'additionalAccepted':count,'globalReservedBytes':used,'globalLimitBytes':POLICY['globalBytes']}
        case('RQ06','跨项目预约还受2GiB总配额约束',global_limit)
    report['summary']={'passed':sum(c['status']=='passed' for c in report['cases']),'failed':sum(c['status']=='failed' for c in report['cases'])}
    report['boundary']='Engineering defaults and isolated SQLite accounting/real-file sizing, not production recovery retention or actual disk exhaustion.'
    pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']))
    return bool(report['summary']['failed'])
if __name__=='__main__':raise SystemExit(main())
