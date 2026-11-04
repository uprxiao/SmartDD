from pathlib import Path
import json, datetime
p=Path('/private/tmp/willyou-m12-p063-prompt-probe-003');r=json.loads((p/'raw.json').read_text());result=r.get('result',{})
expected=[{'label':'accept','value':'accepted-中文'},{'label':'dismiss','value':None},{'label':'srcdoc','value':'accepted-中文','process':'undefined','require':'undefined'},{'label':'cross-http','value':'accepted-中文','process':'undefined','require':'undefined'}]
checks={
 'executed':r.get('status')=='executed-unjudged' and not r.get('errors'),
 'main_and_two_native_iframes':result.get('values')==expected,
 'node_absent':result.get('unsafe')=={'process':'undefined','require':'undefined'},
 'security_unchanged':r.get('security')=={'sandbox':True,'contextIsolation':True,'nodeIntegration':False,'nodeIntegrationInSubFrames':False},
 'four_real_native_callbacks':len(r.get('dialogs',[]))==4,
 'four_actual_cdp_handles':len(r.get('handled',[]))==4,
 'four_open_and_closed':sum(x['method']=='Page.javascriptDialogOpening' for x in r.get('cdp',[]))==4 and sum(x['method']=='Page.javascriptDialogClosed' for x in r.get('cdp',[]))==4,
 'original_handler_restored':r.get('defaultListenerRestored') is True,
 'normal_quit':r.get('quitCode')==0 and r.get('serverClosed') is True and not r.get('timeout')
}
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'passed':all(checks.values()),'boundary':'Native feasibility with actual CDP dialog responses and guarded internal listener; not fixed-helper CLI, production App/UI or original T068 acceptance.'};(p/'adjudication.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False))
