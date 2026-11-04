from pathlib import Path
import json,urllib.parse
r=Path(__file__).parent;d=json.loads((r/'raw.json').read_text());e=json.loads((r/'exit.json').read_text());c=json.loads((r/'cleanup.json').read_text());checks={}
expected={'alert-accept':'undefined','alert-dismiss':'undefined','confirm-accept':'true','confirm-dismiss':'false','prompt-accept':'accepted-中文','prompt-empty':'','prompt-dismiss':'null','srcdoc':'frame-中文','cross-http':'frame-中文'}
for label,value in expected.items():
 rows=[v for v in d['values'] if v['label']==label];checks['return-'+label]=len(rows)==1 and rows[0]['value']==value
checks['actual9NativeCallbacksAnd9ClosedEvents']=len(d['dialogs'])==len(d['closed'])==9 and all('respondedAtMs' in x for x in d['dialogs'])
checks['mainNoNode']=d['mainSecurity']=={'process':'undefined','require':'undefined'}
checks['framesNoNode']=all(v.get('process')=='undefined' and v.get('require')=='undefined' for v in d['values'] if v['label'] in ['srcdoc','cross-http'])
checks['realCrossSite']=urllib.parse.urlparse(d['mainUrl']).hostname=='localhost' and any(x['message']=='cross-http' and urllib.parse.urlparse(x['frameUrl']).hostname=='127.0.0.1' for x in d['dialogs'])
checks['sandboxAndContextIsolation']=d['security']=={'sandbox':True,'contextIsolation':True,'nodeIntegration':False,'nodeIntegrationInSubFrames':False}
checks['noRuntimeErrors']=not d['errors'] and not d.get('error') and not d.get('timeout')
checks['originalHandlerRestored']=d.get('handlerRestored') is True
checks['normalExitNoFallback']=e['code']==0 and not e['signals'] and d['quitCode']==0
checks['exactCleanup']=c['allExactPidsAbsent'] and c['portClosed'] and d['serverClosed']
checks['fixedNativeHandler']=d['handler']['sha256']=='6ca5d7e71e2bc4b9041237def7a569f8b4ebb073722912dd66023cdf680b79d2'
checks['promptInitialTextRetained']=all(x['initial']==('child-initial' if x['message'] in ['srcdoc','cross-http'] else 'initial-中文') for x in d['dialogs'] if x['type']=='prompt')
out={'classification':'native-feasibility-green' if all(checks.values()) else 'failed-or-partial','checks':checks,'counts':{'total':len(checks),'passed':sum(checks.values()),'failed':sum(not x for x in checks.values())},'formalIncrement':0,'boundary':'Hidden fixedElectron direct native callbacks only, no real Helper/CLI/production/App UI/original T068 completion. Page dialog close events are actual CDP events, not forged. Cancel payload ignored by page but appears in event; production must pass empty cancellation text.'};(r/'adjudication.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False))
