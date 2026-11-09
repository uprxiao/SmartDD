import sys
sys.dont_write_bytecode=True
import json,copy,ast
from pathlib import Path
from clipboard_output_privacy import public_clipboard_output,PACKAGE
root=Path(__file__).resolve().parent
base={'schema':'willyou-app-result-v2','status':'ok','source':{'appId':'browser','revision':None,'packageHash':PACKAGE,'connections':[]},'data':{'result':{'text':'WILLYOU_M12_T088_00000000000000000000000000000000'}},'resources':[],'operation':{'id':'11111111-1111-4111-8111-111111111111','requestId':'22222222-2222-4222-8222-222222222222','effectState':'read-only','origin':'cli'},'pagination':None,'completeness':{'complete':True,'missing':[]},'contractMajor':2,'capabilityId':'browser.env.clipboard-read'}
controls=[]
for write in [False,True]:
 expected='x' if write else base['data']['result']['text']
 v=copy.deepcopy(base)
 if write:v.update(data={'result':{'written':'x'}},capabilityId='browser.env.clipboard-write');v['operation']['effectState']='completed'
 accepted=public_clipboard_output(json.dumps(v),'',expected,write)
 assert accepted['expectedSyntheticValueMatched'] and not accepted['clipboardOutputPrivate'] and accepted['stdout']
 controls.append({'name':('write'if write else'read')+'-synthetic-positive','passed':True})
 for mode in ['wrong-value','wrong-layer','error-status','unknown-effect','extra-field','extra-stderr','invalid-json']:
  bad=copy.deepcopy(v);stderr='';payload=None
  if mode=='wrong-value':bad['data']['result']['written'if write else'text']='SYNTHETIC_UNEXPECTED'
  elif mode=='wrong-layer':bad['data']=bad['data']['result']
  elif mode=='error-status':bad['status']='error'
  elif mode=='unknown-effect':bad['operation']['effectState']='unknown'
  elif mode=='extra-field':bad['other']='SYNTHETIC_UNEXPECTED'
  elif mode=='extra-stderr':stderr='SYNTHETIC_UNEXPECTED'
  elif mode=='invalid-json':payload='SYNTHETIC_UNEXPECTED'
  filtered=public_clipboard_output(payload or json.dumps(bad),stderr,expected,write)
  assert not filtered['expectedSyntheticValueMatched'] and filtered['stdout']is None and filtered['stderr']is None and not filtered['originalOrUnexpectedContentIncluded']
  assert 'SYNTHETIC_UNEXPECTED'not in json.dumps(filtered)
  controls.append({'name':('write'if write else'read')+'-'+mode,'passed':True})
ast.parse((root/'receiver.py').read_text())
out={'status':'pure-data-static-green','controls':controls,'positive':2,'negative':14,'receiverASTParsed':True,'clipboardAccessed':False,'nativeStarted':False,'realOutputUsed':False}
(root/'privacy-static-check-v2.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'controls':len(controls),'positive':2,'negative':14,'clipboardAccessed':False}))
