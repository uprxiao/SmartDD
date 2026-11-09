from pathlib import Path
import json,hashlib,datetime
R=Path('/private/tmp/willyou-m12-t024-App036-A-prep-001');r=json.loads((R/'raw.json').read_text());c=json.loads((R/'cleanup.json').read_text());checks=[]
def check(name,f):
 try:f();checks.append({'id':name,'passed':True})
 except Exception as e:checks.append({'id':name,'passed':False,'reason':str(e)})
def yes(v):assert v
for n in [1,2]:
 def validate(n=n):
  x=r['checks'][n-1];assert x['id']=='real-header-closed-workspace-launcher-'+str(n);assert len(x['before']['tabs'])==n-1;assert len(x['after']['tabs'])==n;assert next(t for t in x['after']['tabs'] if t['id']==x['after']['activeId'])['url']=='about:blank';assert [v['id'] for v in x['views']]==[v['id'] for v in x['viewsAfter']]
 check('real-click-closed-workspace-launcher-'+str(n),validate)
check('project-view-no-task-browser-entry',lambda:yes(r['checks'][2]['descriptor']=={'taskNewBrowser':False,'nativeBrowser':False,'projectFiles':True}))
check('one-setup-reload-initial-activation-single-guard-no-yield',lambda:yes(r['reloadCount']==1 and r['initialForeground']['attempts']==1 and r['initialFocus']['actualStableMs']>=3000 and len(r['focusGuards'])==1 and not r['focusGuard'].get('yieldedAt')))
check('same-prepared-PTY-and-own-normal-exit',lambda:yes(r['initialPty'] is not None and r['taskAfter']['ptyId'] is None and r['appCleanup']['normalExitConfirmed'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[]))
check('independent-resources-clear-and-no-General',lambda:yes(c['allClear'] and not c['systemGeneralWasAttempted']))
check('three-exact-business-PNG',lambda:yes(len(r['screenshots'])==3 and all(hashlib.sha256((R/'runtime-001'/x['name']).read_bytes()).hexdigest()==x['sha256'] for x in r['screenshots'])))
o={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'case':'M12-T024','scope':'A subset only: real titlebar click twice and project view negative','passed':all(x['passed'] for x in checks),'checks':checks,'pending':json.loads((R/'contract.json').read_text())['pending'],'wholeCasePassed':False,'formalIncrement':0,'rawSHA256':hashlib.sha256((R/'raw.json').read_bytes()).hexdigest()};(R/'judgement.json').write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n');print(json.dumps(o,ensure_ascii=False));raise SystemExit(0 if o['passed'] else 1)
