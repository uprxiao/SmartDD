#!/usr/bin/env python3
"""Real child SIGKILL and restart read-only reconciliation; synthetic files only.
Uses R3.4 exchange/recovery algorithm; NOT a production broker or power-loss proof.
"""
import errno, hashlib, importlib.util, json, os, pathlib, platform, signal, stat, subprocess, sys, tempfile, time, uuid

HERE = pathlib.Path(__file__).resolve()
spec = importlib.util.spec_from_file_location('previous_save', HERE.with_name('save-recovery-probe.py'))
previous = importlib.util.module_from_spec(spec); spec.loader.exec_module(previous)
sha = lambda x: hashlib.sha256(x).hexdigest()
identity = lambda st: [st.st_dev, st.st_ino]

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
            names=os.listdir(jfd)
            records=[]
            for name in names:
                if not name.endswith('.json'): continue
                fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=jfd)
                try:
                    if os.fstat(fd).st_size>65536: raise ValueError('oversize journal')
                    rec=json.loads(os.read(fd,65537))
                finally: os.close(fd)
                token=str(uuid.UUID(rec['opId']))
                if rec['opId']!=token or name!=token+'.json': raise ValueError('journal identity')
                if rec.get('rootIdentity')!=identity(os.fstat(rfd)): raise ValueError('root replaced')
                expected={'draft':token+'.draft','displaced':token+'.original','staging':'.m9-stage-'+token}
                if any(rec.get(k)!=v for k,v in expected.items()): raise ValueError('unsafe journal path')
                leaf=rec['leaf']
                if not leaf or leaf in ('.','..') or '/' in leaf or '\0' in leaf: raise ValueError('unsafe leaf')
                versions={}
                for key,parent,child in [('current',rfd,leaf),('draft',jfd,rec['draft']),('displaced',jfd,rec['displaced']),('staging',rfd,rec['staging'])]:
                    try: vfd=os.open(child,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
                    except FileNotFoundError: continue
                    try:
                        st=os.fstat(vfd)
                        if not stat.S_ISREG(st.st_mode) or st.st_size>40*1024*1024: raise ValueError('invalid recovery object')
                        data=os.read(vfd,st.st_size+1)
                        versions[key]={'identity':identity(st),'sha256':sha(data),'bytes':len(data)}
                    finally: os.close(vfd)
                if versions.get('draft',{}).get('sha256')!=rec['draftHash']: raise ValueError('draft damaged')
                old=versions.get('displaced') or versions.get('staging')
                if versions.get('current',{}).get('identity')==rec['originalIdentity'] and old and old['identity']==rec['candidateIdentity']:
                    state='prepared-uncommitted'
                else: state='postcommit-review'
                records.append({'opId':token,'state':state,'versions':versions,'automaticMutation':False})
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

def main(out):
    if out.exists(): raise ValueError('Report already exists')
    report={'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'environment':platform.platform(),'scope':'real child SIGKILL, read-only recovery, injected ENOSPC/fsync; NOT physical full disk, power loss or production App','cases':[]}
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
            try: reconcile(root);raise AssertionError('accepted malicious journal')
            except ValueError as e: assert str(e)=='unsafe journal path'
            return {'untrustedPathRejected':True,'noRecoveryMutation':True}
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
    report['scriptSha256']=sha(HERE.read_bytes());report['summary']={s:sum(c['status']==s for c in report['cases']) for s in ['passed','failed']}
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']));return bool(report['summary']['failed'])
if __name__=='__main__':sys.exit(main(pathlib.Path(sys.argv[1])))
