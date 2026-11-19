import hashlib,json,os,sqlite3,stat,sys
from pathlib import Path
root=Path(sys.argv[1]).resolve(strict=True)
attempt=root/'g04/attempt-351'
result=json.loads((attempt/'result.json').read_text())
r=result['cases']['A65-a34-large']
assert 'after.privateBytes>0' in r['error'] and result['rendererErrors']==[]
live=r['incremental']['record']
stored=r['incremental']['registered']
assert live['status']=='complete' and stored['status']=='complete'
assert set(f['path'] for f in live['files'])=={'a34-added.txt','src/0000/file-00000.txt','versioned-seed.txt'}
assert r['firstAnswer']['preparing'] is True and r['firstAfter']['row']['status']=='incomplete'
before=json.loads(stored['before_ref'])
after=json.loads(stored['after_ref'])
assert before['private'] and after['private'] and before['gitDir']==after['gitDir']
assert 'privateBytes' not in before and 'privateBytes' not in after
shadow=Path(after['gitDir']).resolve(strict=True)
assert shadow.is_relative_to(attempt/'data/agent-diffs')
cwd=Path(r['fixture']['privateCwd']).resolve(strict=True)
assert cwd==Path(before['cwd'])==Path(after['cwd']) and cwd.is_relative_to(root/'g04/a34-prep')
assert not (cwd/'.git').exists()
for ref in (before,after):
    rp=shadow/ref['ref']
    assert rp.resolve().is_relative_to(shadow/'refs/willyou/turns')
    assert rp.read_text().strip()==ref['commit']
private_bytes=0
count=0
for path,folders,files in os.walk(shadow,followlinks=False):
    for name in folders+files:
        st=(Path(path)/name).lstat()
        assert not stat.S_ISLNK(st.st_mode)
        if stat.S_ISREG(st.st_mode):
            count+=1
            private_bytes+=st.st_size
assert 0<private_bytes<=1024**3
with (cwd/'.svn/wc.db').open('rb') as f:
    svn_sha=hashlib.file_digest(f,'sha256').hexdigest()
assert svn_sha==r['fixture']['svnMetadataSha256']
assert (cwd/'a34-added.txt').read_text().strip()=='added'
assert not (cwd/'src/0000/file-00000.txt').exists()
assert (cwd/'versioned-seed.txt').read_text().endswith('A34_PRODUCTION_SVN_CHANGED\n')
p=attempt/'data/smartdd.db'
assert all(not Path(str(p)+s).exists() for s in ('-wal','-shm'))
db=sqlite3.connect(p.as_uri()+'?immutable=1&mode=ro',uri=True)
row=db.execute('select before_ref,after_ref,status from agent_turn_changes where turn_id=?',(stored['turn_id'],)).fetchone()
assert row==(stored['before_ref'],stored['after_ref'],'complete')
proof={'case':'A34 synthetic 10 GiB firm-size subcriteria','attempt':351,'packageCommit':result['sourceCommit'],'packageAsar':result['build']['appAsarSha256'],
    'fixture':r['fixture'],'firstAnswerMs':r['firstAnswer']['at'],'baselineCompletedMs':r['firstAfter']['elapsedMs'],
    'incrementalMs':r['incremental']['elapsedMs'],'privateShadowFileLogicalBytes':private_bytes,'privateShadowFiles':count,'priorAndPostRefs':[before['ref'],after['ref']],
    'changedFiles':live['files'],'svnMetadataSha256After':svn_sha,'rendererErrors':result['rendererErrors'],'exit':result['exit'],
    'driverFailure':'The test looked for transient privateBytes in persisted TreeRef, but the store intentionally keeps that value in memory for reuse.'}
print(json.dumps(proof,ensure_ascii=False,indent=2))
