from pathlib import Path
import subprocess,tempfile,json,os,hashlib
repo=Path.cwd();out=os.environ['M14_REVIEW_OUT'];root=Path(tempfile.mkdtemp(prefix='m14-review-merge-'));wc=root/'repo';wc.mkdir()
baseenv={**os.environ,'GIT_AUTHOR_NAME':'Review Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid','GIT_COMMITTER_NAME':'Review Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid'}
def git(*args,env=None,check=True):return subprocess.run(['git',*args],cwd=wc,env={**baseenv,**(env or {})},capture_output=True,text=True,check=check)
git('init','-q','-b','main');(wc/'seed.txt').write_text('base\n');git('add','-A');git('commit','-qm','init');base=git('rev-parse','HEAD').stdout.strip()
git('switch','-qc','child');(wc/'important.txt').write_text('required child feature\n');git('add','-A');fixed={'GIT_AUTHOR_DATE':'2026-11-16T10:00:00+0800','GIT_COMMITTER_DATE':'2026-11-16T10:00:00+0800'};git('commit','-qm','add feature',env=fixed);child=git('rev-parse','HEAD').stdout.strip()
git('switch','-q','main');(wc/'unrelated.txt').write_text('unrelated change\n');git('add','-A');git('commit','-qm','add feature',env=fixed)
# Evaluate the exact exported function text, without importing its top-level experiment mutations.
source=repo/'docs/里程碑/M14_统一Agent工作区/技研/复核_20261116/probes/merge-agents.mjs'
s=source.read_text();a=s.index('export function missingChildCommits');b=s.index('\nfunction hostCheck',a);fn=s[a:b].replace('export function','function',1)
node="""const {execFileSync}=require('node:child_process');const fn=process.argv[1],repo=process.argv[2],base=process.argv[3];const git=(cwd,...a)=>execFileSync('git',a,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();const tryGit=(cwd,...a)=>{try{return git(cwd,...a)}catch(e){return 'ERR '+(e.stderr||e.message).toString().slice(0,200)}};eval(fn);console.log(JSON.stringify({missing:missingChildCommits(repo,'child',base)}));"""
r=json.loads(subprocess.check_output(['node','-e',node,fn,str(wc),base],text=True))
r.update({'scope':'exact research verifier function, isolated Git fixture; no production/model run','source':str(source.relative_to(repo)),'functionSha256':hashlib.sha256(fn.encode()).hexdigest(),'cwd':str(wc),'childCommit':child,'actuallyAncestor':git('merge-base','--is-ancestor',child,'HEAD',check=False).returncode==0,'gitCherry':git('cherry','HEAD','child').stdout.strip(),'childFeaturePresent':(wc/'important.txt').exists(),'workingTreeClean':git('status','--porcelain').stdout.strip()=='','unchangedBranch':git('branch','--show-current').stdout.strip()=='main'})
Path(out,'merge-false-positive.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False,indent=2))
assert r['missing']==[] and not r['actuallyAncestor'] and not r['childFeaturePresent']
