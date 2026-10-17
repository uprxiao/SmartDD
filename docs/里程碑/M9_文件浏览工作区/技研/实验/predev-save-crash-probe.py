#!/usr/bin/env python3
"""Real child SIGKILL and restart read-only reconciliation; synthetic files only.
Uses R3.4 exchange/recovery algorithm; NOT a production broker or power-loss proof.
"""
import errno, hashlib, importlib.util, json, os, pathlib, platform, select, signal, stat, subprocess, sys, tempfile, time, uuid

HERE = pathlib.Path(__file__).resolve()
spec = importlib.util.spec_from_file_location('previous_save', HERE.with_name('save-recovery-probe.py'))
previous = importlib.util.module_from_spec(spec); spec.loader.exec_module(previous)
sha = lambda x: hashlib.sha256(x).hexdigest()
identity = lambda st: [st.st_dev, st.st_ino]
RECOVERY_SCAN_BUDGET_SECONDS = 1.0  # Frozen before the new hostile-object checks.

def read_regular_at(parent, child, limit):
    """O_NONBLOCK prevents FIFO open from hanging before fstat can reject it.
    It does not make regular disk I/O cancellable; production runs reconciliation
    in a supervised worker with a wall-clock deadline as well.
    """
    fd=os.open(child, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK, dir_fd=parent)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode): raise ValueError('non-regular recovery object')
        if before.st_size>limit: raise ValueError('oversize recovery object')
        data=bytearray()
        while len(data)<=limit:
            chunk=os.read(fd,min(65536,limit+1-len(data)))
            if not chunk: break
            data.extend(chunk)
        if len(data)>limit: raise ValueError('recovery object grew beyond limit')
        after=os.fstat(fd)
        version=lambda st:(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
        if version(before)!=version(after) or len(data)!=after.st_size:
            raise ValueError('recovery object changed during read')
        return bytes(data),after
    finally: os.close(fd)

def reconcile_record(rfd,jfd,name):
    if len(name)!=41 or name[-5:]!='.json': raise ValueError('journal filename')
    if str(uuid.UUID(name[:-5]))!=name[:-5]: raise ValueError('journal filename')
    raw,_=read_regular_at(jfd,name,65536)
    rec=json.loads(raw)
    if not isinstance(rec,dict): raise ValueError('journal must be an object')
    if rec.get('schemaVersion')!=1: raise ValueError('journal schema')
    if not isinstance(rec.get('opId'),str): raise ValueError('journal opId must be a string')
    token=str(uuid.UUID(rec['opId']))
    if rec['opId']!=token or name!=token+'.json': raise ValueError('journal identity')
    if rec.get('rootIdentity')!=identity(os.fstat(rfd)): raise ValueError('root replaced')
    expected={'draft':token+'.draft','displaced':token+'.original','staging':'.m9-stage-'+token}
    if any(rec.get(k)!=v for k,v in expected.items()): raise ValueError('unsafe journal path')
    leaf=rec['leaf']
    if not isinstance(leaf,str) or not leaf or leaf in ('.','..') or '/' in leaf or '\0' in leaf:
        raise ValueError('unsafe leaf')
    for key in ['baseHash','draftHash']:
        value=rec.get(key)
        if not isinstance(value,str) or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):
            raise ValueError('invalid journal hash')
    versions={}
    for key,parent,child in [('current',rfd,leaf),('draft',jfd,rec['draft']),('displaced',jfd,rec['displaced']),('staging',rfd,rec['staging'])]:
        try: data,st=read_regular_at(parent,child,40*1024*1024)
        except FileNotFoundError: continue
        versions[key]={'identity':identity(st),'sha256':sha(data),'bytes':len(data)}
    if versions.get('draft',{}).get('sha256')!=rec['draftHash']: raise ValueError('draft damaged')
    old=versions.get('displaced') or versions.get('staging')
    if versions.get('current',{}).get('identity')==rec['originalIdentity'] and old and old['identity']==rec['candidateIdentity']:
        state='prepared-uncommitted' if versions['current']['sha256']==rec['baseHash'] and old['sha256']==rec['draftHash'] else 'recovery-conflict'
    else: state='postcommit-review'
    return {'opId':token,'state':state,'versions':versions,'automaticMutation':False}

def record_identity(root):
    name = next((root/'.m9-recovery').glob('*.json'))
    rec = json.loads(name.read_bytes())
    rec.update(schemaVersion=1, rootIdentity=identity(root.stat()), originalIdentity=identity((root/'file.txt').stat()),
               candidateIdentity=identity((root/rec['staging']).stat()))
    with name.open('w') as f:
        json.dump(rec, f); f.flush(); os.fsync(f.fileno())

def reconcile(root):
    """Never trust path text in a journal; only anchored direct child names.
    No writes, swaps, deletes, or automatic saved acknowledgements during recovery.
    """
    rfd=os.open(root, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        jfd=os.open('.m9-recovery',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=rfd)
        try:
            names=sorted(os.listdir(jfd))
            records=[]
            for name in names:
                if not name.endswith('.json'): continue
                try: records.append(reconcile_record(rfd,jfd,name))
                except (OSError,ValueError,KeyError,TypeError,RecursionError) as error:
                    # Logical quarantine only: no rename/delete. One malformed
                    # transaction must not hide other recoverable operations.
                    records.append({'journalName':name,'state':'quarantined-record',
                                    'reason':str(error),'errorType':type(error).__name__,
                                    'automaticMutation':False})
            return records
        finally: os.close(jfd)
    finally: os.close(rfd)

def child_save(root,stage):
    def before():
        record_identity(root)
        if stage=='prepared': os.kill(os.getpid(),signal.SIGKILL)
    def after():
        if stage=='swapped': os.kill(os.getpid(),signal.SIGKILL)
    previous.journal_save(root,'file.txt',b'DRAFT',sha(b'BASE'),before_swap=before,after_swap=after)
    os.kill(os.getpid(),signal.SIGKILL)

def bounded_reconcile(root):
    """A real supervised child keeps a regression from hanging the probe itself."""
    readfd,writefd=os.pipe();started=time.monotonic();pid=os.fork()
    if pid==0:
        os.close(readfd)
        try:
            payload=json.dumps({'records':reconcile(root)}).encode()
            while payload:
                count=os.write(writefd,payload);payload=payload[count:]
        finally:
            os.close(writefd);os._exit(0)
    os.close(writefd);data=bytearray();done=False
    try:
        while True:
            remaining=RECOVERY_SCAN_BUDGET_SECONDS-(time.monotonic()-started)
            if remaining<=0 or not select.select([readfd],[],[],remaining)[0]:
                raise AssertionError('recovery child exceeded frozen 1s deadline')
            chunk=os.read(readfd,65536)
            if not chunk: break
            data.extend(chunk)
            if len(data)>65536: raise AssertionError('unexpected test response size')
        _,status=os.waitpid(pid,0);done=True
        assert os.WIFEXITED(status) and os.WEXITSTATUS(status)==0
        return json.loads(data)['records'],round((time.monotonic()-started)*1000,2)
    finally:
        os.close(readfd)
        if not done:
            try: os.kill(pid,signal.SIGKILL)
            except ProcessLookupError: pass
            os.waitpid(pid,0)

def inventory(root):
    facts={}
    for parent,dirs,files in os.walk(root,followlinks=False):
        for name in dirs+files:
            path=pathlib.Path(parent)/name;st=path.lstat()
            facts[str(path.relative_to(root))]={'type':stat.S_IFMT(st.st_mode),'inode':st.st_ino,
                'hash':sha(path.read_bytes()) if stat.S_ISREG(st.st_mode) else None,
                'link':os.readlink(path) if stat.S_ISLNK(st.st_mode) else None}
    return facts

def main(out):
    if out.exists(): raise ValueError('Report already exists')
    report={'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'environment':platform.platform(),'scope':'real child SIGKILL, read-only recovery, FIFO/type/quarantine, injected ENOSPC/fsync; NOT physical full disk, power loss, cross-volume layout or production App','recoveryScanBudgetSeconds':RECOVERY_SCAN_BUDGET_SECONDS,'cases':[]}
    def run(cid,title,fn):
        try: evidence=fn(); status='passed'
        except Exception as e: evidence={'error':repr(e)};status='failed'
        report['cases'].append({'id':cid,'title':title,'status':status,'evidence':evidence})
    with tempfile.TemporaryDirectory(prefix='m9-predev-save-') as tmp:
        base=pathlib.Path(tmp)
        def fresh(n):
            root=base/n;root.mkdir();(root/'file.txt').write_bytes(b'BASE');return root
        def killed(stage):
            root=fresh(stage);pid=os.fork()
            if pid==0:
                try: child_save(root,stage)
                finally: os._exit(3)
            _,status=os.waitpid(pid,0)
            assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL
            a=reconcile(root);assert len(a)==1
            expected='prepared-uncommitted' if stage=='prepared' else 'postcommit-review'
            assert a[0]['state']==expected
            hashes={v['sha256'] for v in a[0]['versions'].values()}; assert sha(b'BASE') in hashes and sha(b'DRAFT') in hashes
            before={str(p.relative_to(root)):sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
            assert reconcile(root)==a
            assert before=={str(p.relative_to(root)):sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
            return {'childSignal':9,'recovered':a,'recoveryIsIdempotentAndReadOnly':True}
        for stage in ['prepared','swapped','returned']:
            run('SC-'+stage,'真实SIGKILL于'+stage+'阶段，启动恢复保留全部可见版本',lambda s=stage:killed(s))
        def full_disk():
            root=fresh('injected-enospc');original=previous.full_write
            def fail(fd,data): raise OSError(errno.ENOSPC,'injected disk full')
            previous.full_write=fail
            try:
                try: previous.journal_save(root,'file.txt',b'DRAFT',sha(b'BASE'));raise AssertionError('not failed')
                except OSError as e: assert e.errno==errno.ENOSPC
            finally: previous.full_write=original
            assert (root/'file.txt').read_bytes()==b'BASE'
            return {'targetUnchanged':True,'fault':'injected ENOSPC before commit','physicalDiskFilled':False,'memoryDraftMustRemain':True}
        run('SC-enospc','提交前草稿写失败不修改原件',full_disk)
        def post_sync():
            root=fresh('fsync-error');original=os.fsync
            def after():
                def fail(fd): raise OSError(errno.EIO,'injected directory fsync failure')
                os.fsync=fail
            try:
                try: previous.journal_save(root,'file.txt',b'DRAFT',sha(b'BASE'),before_swap=lambda:record_identity(root),after_swap=after);raise AssertionError('not failed')
                except OSError as e: assert e.errno==errno.EIO
            finally: os.fsync=original
            a=reconcile(root);assert a[0]['state']=='postcommit-review'
            assert sha(b'BASE') in {x['sha256'] for x in a[0]['versions'].values()}
            return {'recovered':a,'mayNotReportSaved':True,'fault':'injected fsync EIO after exchange'}
        run('SC-fsync','提交后fsync失败保留冲突版本，不能谎报未写入或已保存',post_sync)
        def tampered():
            root=fresh('tampered');previous.journal_save(root,'file.txt',b'DRAFT',sha(b'BASE'),before_swap=lambda:record_identity(root))
            recfile=next((root/'.m9-recovery').glob('*.json'));rec=json.loads(recfile.read_bytes());rec['draft']='../../outside';recfile.write_text(json.dumps(rec))
            before=inventory(root);results=reconcile(root)
            assert len(results)==1 and results[0]['state']=='quarantined-record' and results[0]['reason']=='unsafe journal path'
            assert inventory(root)==before
            return {'untrustedPathRejected':True,'noRecoveryMutation':True,'recordIsolated':results[0]}
        run('SC-journal','启动重核日志字段，不按篡改路径读取或清理',tampered)
        def metadata():
            root=fresh('metadata');a=root/'file.txt';os.chmod(a,0o640)
            subprocess.run(['/usr/bin/xattr','-w','com.willyou.m9-probe','fixture',str(a)],check=True)
            st=a.stat();candidate=root/'metadata-candidate';candidate.write_bytes(b'DRAFT')
            os.chmod(candidate,stat.S_IMODE(st.st_mode))
            # This probe copies only its own synthetic attribute, not arbitrary metadata.
            value=subprocess.check_output(['/usr/bin/xattr','-px','com.willyou.m9-probe',str(a)]).decode().strip().replace(' ','').replace('\n','')
            subprocess.run(['/usr/bin/xattr','-wx','com.willyou.m9-probe',value,str(candidate)],check=True)
            assert stat.S_IMODE(candidate.stat().st_mode)==0o640 and subprocess.check_output(['/usr/bin/xattr','-p','com.willyou.m9-probe',str(candidate)]).strip()==b'fixture'
            assert candidate.stat().st_uid==st.st_uid and candidate.stat().st_gid==st.st_gid
            return {'mode':'0640','syntheticXattrPreserved':True,'sameOwnerAndGroup':True,'ACL':'not tested; preserve via platform metadata adapter before commit, fail closed if it cannot preserve required metadata'}
        run('SC-metadata','本机权限和自有xattr可在提交前复制并回读',metadata)
        def hostile_journals():
            root=fresh('hostile-journals');previous.journal_save(root,'file.txt',b'DRAFT',sha(b'BASE'),before_swap=lambda:record_identity(root))
            journal=root/'.m9-recovery';bad=[]
            def name():
                path=journal/(str(uuid.uuid4())+'.json');bad.append(path.name);return path
            fifo=name();os.mkfifo(fifo)
            directory=name();directory.mkdir()
            canary=base/'journal-outside-canary';canary.write_bytes(b'OUTSIDE');link=name();link.symlink_to(canary)
            malformed=name();malformed.write_bytes(b'{"opId":')
            oversized=name();oversized.write_bytes(b'X'*65537)
            nonobject=name();nonobject.write_bytes(b'[]')
            wrongtype=name();wrongtype.write_bytes(b'{"schemaVersion":1,"opId":123}')
            deep=name();deep.write_bytes(b'['*1200+b'0'+b']'*1200)
            before=inventory(root);rows,ms=bounded_reconcile(root)
            good=[r for r in rows if r['state']!='quarantined-record'];badrows=[r for r in rows if r['state']=='quarantined-record']
            assert len(good)==1 and len(badrows)==8
            assert {r['journalName'] for r in badrows}==set(bad)
            assert inventory(root)==before and canary.read_bytes()==b'OUTSIDE'
            assert all(r['automaticMutation'] is False for r in rows)
            return {'actualObjects':['FIFO','directory','symlink','truncated JSON','oversize regular file','non-object JSON','non-string opId','excessive JSON nesting'],
                    'elapsedMs':ms,'isolatedRecords':badrows,'healthyRecordsRecovered':len(good),
                    'noFilesystemMutation':True,'outsideCanaryUnchanged':True}
        run('SC-journal-types','真实FIFO/目录/symlink/损坏/超大日志被隔离，健康记录继续恢复',hostile_journals)
        def hostile_version():
            root=fresh('hostile-version');previous.journal_save(root,'file.txt',b'DRAFT',sha(b'BASE'),before_swap=lambda:record_identity(root))
            journal=root/'.m9-recovery';valid=next(journal.glob('*.json'));rec=json.loads(valid.read_bytes());token=str(uuid.uuid4())
            rec.update(opId=token,draft=token+'.draft',displaced=token+'.original',staging='.m9-stage-'+token)
            (journal/(token+'.json')).write_text(json.dumps(rec));os.mkfifo(journal/rec['draft'])
            before=inventory(root);rows,ms=bounded_reconcile(root);bad=[r for r in rows if r['state']=='quarantined-record']
            assert len(bad)==1 and bad[0]['reason']=='non-regular recovery object'
            assert len([r for r in rows if r['state']=='postcommit-review'])==1 and inventory(root)==before
            return {'actualObject':'FIFO at exact allowlisted draft leaf','elapsedMs':ms,'isolatedRecord':bad[0],
                    'healthyRecordsRecovered':1,'noFilesystemMutation':True}
        run('SC-version-fifo','合法内部draft名称上的真实FIFO不阻塞，不影响另一健康记录',hostile_version)
        def prepared_changed():
            root=fresh('prepared-content-changed');pid=os.fork()
            if pid==0:
                try: child_save(root,'prepared')
                finally: os._exit(3)
            _,status=os.waitpid(pid,0);assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL
            inode=(root/'file.txt').stat().st_ino;(root/'file.txt').write_bytes(b'EXTERNAL_CHANGE')
            assert (root/'file.txt').stat().st_ino==inode
            before=inventory(root);rows=reconcile(root);assert len(rows)==1 and rows[0]['state']=='recovery-conflict'
            assert inventory(root)==before
            return {'sameInodeExternalChangeDetectedByHash':True,'state':rows[0]['state'],'noAutomaticResumeOrMutation':True}
        run('SC-prepared-hash','prepared阶段目标inode未变但内容外改，按hash进入冲突而非可恢复提交',prepared_changed)
    report['scriptSha256']=sha(HERE.read_bytes());report['dependencySha256']={p.name:sha(p.read_bytes()) for p in [HERE.with_name('save-recovery-probe.py'),HERE.with_name('anchored-save-probe.py')]};report['summary']={s:sum(c['status']==s for c in report['cases']) for s in ['passed','failed']}
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']));return bool(report['summary']['failed'])
if __name__=='__main__':sys.exit(main(pathlib.Path(sys.argv[1])))
