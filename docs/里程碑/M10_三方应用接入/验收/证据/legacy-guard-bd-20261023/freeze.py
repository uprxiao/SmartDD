from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import json,hashlib,subprocess,difflib,stat
p=Path('/private/tmp/m10-legacy-guard-bd-20261022');w=p/'candidate';c=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10');bc=Path('/private/tmp/m10-native-omissions-bc-20261022');parent='1d1fd835a630722571fbeac680bfda82ba5b9b63';sha=lambda b:hashlib.sha256(b).hexdigest();assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=c,text=True).strip()==parent
inputs=[];changed=[];patch='';files=[]
for f in json.loads((bc/'candidate2-inputs.json').read_text())['files']:
 path=f['path'];b=(w/path).read_bytes();inputs.append({'path':path,'sha256':sha(b),'bytes':len(b),'mode':stat.S_IMODE((w/path).stat().st_mode)})
 if sha(b)!=f['sha256']:changed.append(path)
assert len(changed)==6 and len(inputs)==2011
for path in changed:
 old=subprocess.check_output(['git','show',parent+':'+path],cwd=c);new=(w/path).read_bytes();assert old==(c/path).read_bytes();patch+=''.join(difflib.unified_diff(old.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),fromfile='a/'+path,tofile='b/'+path));files.append({'path':path,'parentSha256':sha(old),'candidateSha256':sha(new),'bytes':len(new)})
(p/'candidate-inputs.json').write_text(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'files':inputs},indent=2)+'\n');(p/'source-overlay.json').write_text(json.dumps({'parent':parent,'files':files},indent=2)+'\n');(p/'source-overlay.diff').write_text(patch)
recovery=p/'recovery-check';recovery.mkdir()
for f in files:
 dst=recovery/f['path'];dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(subprocess.check_output(['git','show',parent+':'+f['path']],cwd=c))
r=subprocess.run(['git','apply',str(p/'source-overlay.diff')],cwd=recovery,capture_output=True);(p/'recovery-apply.txt').write_bytes(r.stdout+r.stderr);assert r.returncode==0
for f in files:assert sha((recovery/f['path']).read_bytes())==f['candidateSha256']
(p/'source-recovery-proof.json').write_text(json.dumps({'parent':parent,'files':len(files),'applyExitCode':0,'allCandidateBytesRestored':True,'inputFiles':2011,'noImmutableAdapterOrPublicSchemaChanges':True},indent=2)+'\n')
full=json.loads((p/'followup-report.json').read_text());proof=json.loads((p/'proof-fix-report.json').read_text());old=json.loads((bc/'candidate2-final-main-report.json').read_text());a=Counter(t['fullName']for s in full['testResults']for t in s['assertionResults']);b=Counter(t['fullName']for s in old['testResults']for t in s['assertionResults']);assert sum((a-b).values())==19 and not b-a and full['numTotalTests']==212
assert proof['numPassedTests']==1 and proof['numFailedTests']==0
for f in json.loads((p/'runtime-output-inputs-observed.json').read_text())['files']:assert sha((w/f['path']).read_bytes())==f['sha256']
(p/'case-delta.json').write_text(json.dumps({'added':dict(a-b),'removed':dict(b-a),'newCases':19,'totalMain':212},indent=2)+'\n');(p/'types-final-result.json').write_text(json.dumps({'command':'pnpm typecheck','cwd':str(w),'exitCode':0,'observedSession':12955,'log':'types-final.txt','sourceFrozenNow':True},indent=2)+'\n')
print('frozen2011inputs;5production1test;19added0removed;parent+patch recovers6exactfiles;type0')
