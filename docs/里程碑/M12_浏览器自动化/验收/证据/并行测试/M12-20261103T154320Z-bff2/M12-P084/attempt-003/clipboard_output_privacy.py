"""Pure data filter: original/unknown clipboard output never becomes public data.
No filesystem, clipboard, process, hashing or network operations in this module.
"""
import json,re
PACKAGE='eb7f1cbfad4f8d9246ff261f8b64b2d8d778d6c28ae551b9f926fb8998f86140'
UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
def public_clipboard_output(stdout,stderr,expected,write=False):
 safe={'clipboardOutputPrivate':True,'expectedSyntheticValueMatched':False,'stdout':None,'stderr':None,'originalOrUnexpectedContentIncluded':False}
 try:
  v=json.loads(stdout);assert isinstance(v,dict)
  assert set(v)=={'schema','status','source','data','resources','operation','pagination','completeness','contractMajor','capabilityId'}
  assert v['schema']=='willyou-app-result-v2' and v['status']=='ok' and v['contractMajor']==2 and stderr==''
  assert v['capabilityId']==('browser.env.clipboard-write'if write else'browser.env.clipboard-read')
  assert v['source']=={'appId':'browser','revision':None,'packageHash':PACKAGE,'connections':[]}
  assert v['data']=={'result':{'written'if write else'text':expected}}
  assert v['resources']==[] and v['pagination']is None and v['completeness']=={'complete':True,'missing':[]}
  op=v['operation'];assert set(op)=={'id','requestId','effectState','origin'}
  assert UUID.fullmatch(op['id']) and UUID.fullmatch(op['requestId']) and op['origin']=='cli'
  assert op['effectState']==('completed'if write else'read-only')
  safe.update(clipboardOutputPrivate=False,expectedSyntheticValueMatched=True,stdout=stdout,stderr='')
 except(AssertionError,TypeError,ValueError,KeyError):pass
 return safe
