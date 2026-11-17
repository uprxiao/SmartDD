#!/usr/bin/env python3
"""Git hidden refs with a private index preserve the real HEAD and staged state."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root=Path(tempfile.mkdtemp(prefix='m14-git-checkpoint-'));rows={}
env={**os.environ,'GIT_AUTHOR_NAME':'probe','GIT_AUTHOR_EMAIL':'probe@example.invalid',
     'GIT_COMMITTER_NAME':'probe','GIT_COMMITTER_EMAIL':'probe@example.invalid'}
def git(*a,private=False):
    return subprocess.check_output(['git',*a],cwd=root,env={**env,**({'GIT_INDEX_FILE':str(root/'.git/willyou-index')} if private else {})},stderr=subprocess.PIPE,text=True).strip()
try:
    git('init');(root/'tracked.txt').write_text('initial\n');git('add','.');git('commit','-m','seed')
    (root/'tracked.txt').write_text('staged\n');git('add','tracked.txt');(root/'tracked.txt').write_text('dirty\n')
    (root/'rename-me.txt').write_text('rename unchanged\n');(root/'delete-me.txt').write_text('delete\n')
    head=git('rev-parse','HEAD');index=(root/'.git/index').read_bytes()
    def snap(label):
        git('add','-A',private=True);tree=git('write-tree',private=True)
        commit=git('commit-tree',tree,'-m',label);git('update-ref','refs/willyou/turns/probe/'+label,commit);return commit
    before=snap('before')
    (root/'tracked.txt').write_text('modified by synthetic run\n');(root/'rename-me.txt').rename(root/'renamed.txt');(root/'delete-me.txt').unlink();(root/'binary.bin').write_bytes(b'\x00\x01binary')
    after=snap('after')
    diff=git('diff-tree','--no-commit-id','-r','-M','--name-status',before,after)
    rows={'headUnchanged':git('rev-parse','HEAD')==head,'userIndexByteIdentical':(root/'.git/index').read_bytes()==index,
          'stagedVersionPreserved':git('show',':tracked.txt')=='staged',
          'beforeCapturedDirtyWorktree':git('show',before+':tracked.txt')=='dirty',
          'renameDetected':any(x.startswith('R100') for x in diff.splitlines()),
          'deleteDetected':'D\tdelete-me.txt' in diff,'binaryDetected':'A\tbinary.bin' in diff,
          'hiddenRefsExist':len(git('for-each-ref','--format=%(refname)','refs/willyou/turns/').splitlines())==2}
    result={'scope':'real isolated Git repository; private index and hidden refs only; no product UI',
            'checks':rows,'diff':diff.splitlines(),'status':'passed' if all(rows.values()) else 'failed'}
except Exception as e:result={'status':'failed','error':str(e),'checks':rows}
finally:
    shutil.rmtree(root);result['cleanup']=not root.exists()
    (Path(__file__).parent/'results/git-checkpoint.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));raise SystemExit(result['status']!='passed')
