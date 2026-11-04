from pathlib import Path
import json,hashlib,datetime
p=Path(__file__).resolve().parent;r=json.loads((p/'raw.json').read_text());c=json.loads((p/'cleanup.json').read_text());checks=[]
def check(name,fn):
 try:fn();checks.append({'id':name,'status':'passed'})
 except Exception as e:checks.append({'id':name,'status':'failed','error':str(e)})
def yes(x,message='predicate false'):assert x,message
check('actual-frozen-App012',lambda:yes(r['instances'][0]['runtime']['version']=='0.1.1' and r['instances'][0]['runtime']['versions']['electron']=='42.11.14' and r['instances'][0]['runtime']['userData']==str(p/'runtime-001/userdata')))
check('same-project-and-distinct-other-project',lambda:yes(r['tasks'][0]['task']['projectId']==r['tasks'][1]['task']['projectId']!=r['tasks'][2]['task']['projectId']))
check('originalT076-all-account-results',lambda:yes([r[k]['account'] for k in ['t1','t2','t3']]==['qa','qa','未登录']))
def network():
 yes(any(v['method']=='POST' and v.get('task')=='T1' and v.get('loginAccount')=='qa' for v in r['requests']))
 yes(any(v['method']=='GET' and v.get('task')=='T2' and v.get('account')=='qa' for v in r['requests']))
 yes(any(v['method']=='GET' and v.get('task')=='T3' and v.get('account') is None for v in r['requests']))
 yes(not any(v['method']=='POST' and v.get('task')=='T2' and v.get('loginAccount')=='qa' for v in r['requests']))
check('realHTTP-correlates-shared-login-no-second-qa-login',network)
def input_():
 a=r['actions'];yes(sum(v.get('kind')=='field' and v.get('selector')=='[aria-label="网页地址"]' for v in a)==3)
 for t in r['tasks']:yes(any(t['task']['id'] in v.get('selector','') for v in a))
 code=(p/'run.mjs').read_text();yes("await page.field('#user',user);await page.click('#login')" in code)
 yes("app.invoke('browser.navigate'" not in code and "app.invoke('browser.create'" not in code and "app.invoke('browser.createProfile'" not in code and "app.invoke('browser.useProfile'" not in code)
check('actualUI-browser-navigation-and-form-not-businessRPC',input_)
check('fresh-initial-nativeDOM-focus-and-no-yield',lambda:yes(len(r['focusGuards'])==1 and r['focusGuards'][0]['installedAfterInitialNativeAndDOMFocus'] and not r['focusGuards'][0].get('yieldedAt') and r['initialFocusWaits'][0]['status']=='focused'))
check('B12-separate-supplement-qa2-source-qa',lambda:yes(r['independent']['account']=='qa2' and r['sourceAfterIndependent']['account']=='qa' and any(x['profile']['scope']=='isolated' and x['profile']['owner']=={'kind':'task','id':r['tasks'][1]['task']['id']} for x in r['profileRecords'])))
check('normal-quit-and-independent-cleanup',lambda:yes(r['status']=='executed' and r['serverClosed'] and not r.get('forcedAppCleanup') and c['allExactPidsAbsent'] and c['allExactPortsClosed'] and c['normalAppExit']['code']==0 and c['normalAppExit']['signal'] is None))
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalCase':'M12-T076','status':'passed' if all(v['status']=='passed' for v in checks) else 'failed','layer':'A','checks':checks,'supplementOnly':'B12 actualcreate/use; not T077CLI-I/T079restart/full management acceptance','screenshotBoundary':'Main-renderer Page.captureScreenshot excludes child WebContentsView pixel layer. Account outcomes use actual native-page Runtime reads, presented-view checks, actual Input form actions and HTTP server receipts; no visual equivalence/T145 claim.','rawSha256':hashlib.sha256((p/'raw.json').read_bytes()).hexdigest()};(p/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
