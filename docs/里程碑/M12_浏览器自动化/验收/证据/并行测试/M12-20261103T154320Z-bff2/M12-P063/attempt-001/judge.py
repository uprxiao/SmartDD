import json, pathlib, datetime
p = pathlib.Path('/private/tmp/willyou-m12-p063-prompt-probe-001')
r = json.loads((p/'raw.json').read_text())
checks = {
 'executed': r.get('status') == 'executed-unjudged' and not r.get('errors'),
 'main_accept_and_dismiss': r.get('result',{}).get('main') == [{'message':'accept','value':'accepted-中文'},{'message':'dismiss','value':None}],
 'iframe_same_preload': r.get('result',{}).get('child') == {'value':'accepted-中文','process':'undefined','require':'undefined'},
 'main_no_node': r.get('result',{}).get('unsafe') == {'process':'undefined','require':'undefined'},
 'security_preferences': r.get('sandboxed',{}).get('sandbox') is True and r.get('sandboxed',{}).get('contextIsolation') is True and r.get('sandboxed',{}).get('nodeIntegration') is False,
 'three_real_ipc_calls': [x['message'] for x in r.get('calls',[])] == ['accept','dismiss','iframe'],
 'normal_quit': r.get('quitCode') == 0 and not r.get('timeout')
}
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'passed':all(checks.values()),'boundary':'Native Electron technical feasibility only. Host scripted responses are explicit; no nativeCLI/helper, production integration, App UI acceptance or model R.'}
(p/'adjudication.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
