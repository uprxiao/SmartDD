from pathlib import Path
import json
root=Path(__file__).resolve().parent
def rows(p):return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
a=root/'attempt-NOr44a';b=root/'attempt-orMZ27';c=root/'attempt-GHhP9N'
checks=[]
for driver,p in [('claude',a),('codex',b)]:
 result=json.loads((p/'result.json').read_text())
 for action in ['accept','decline','cancel','bad-auth']:
  id=driver+'-'+action;case=next(x for x in result['checks'] if x['id']==id);assert case['status']=='passed'
  callback=[x for x in rows(p/'elicitation.jsonl') if x['id']==id]
  tool=[x for x in rows(p/'mcp-tool-result.jsonl') if x['id']==id]
  requests=[x for x in rows(p/'http.jsonl') if x['id']==id]
  assert requests and all(not x['modelCredentialSeen'] for x in requests)
  if action=='bad-auth':assert not callback and not tool and all(not x['authorized'] for x in requests)
  else:
   assert len(callback)==len(tool)==1
   assert callback[0]['response']==tool[0]['result']
   assert tool[0]['result']['action']==action
   assert all(x['authorized'] for x in requests)
   if action=='accept':assert tool[0]['result']['content']=={'label':'isolated-choice','count':2,'enabled':True}
   else:assert 'content' not in tool[0]['result']
   if driver=='codex':
    native=[x for x in rows(p/(id+'.wire.jsonl')) if x.get('method')=='mcpServer/elicitation/request'];assert len(native)==1
    assert native[0]['id']==callback[0]['identity']['rpcId']
    for key in ['threadId','turnId']:assert native[0]['params'][key]==case['detail'][key]==callback[0]['identity'][key]
  checks.append({'id':id,'attempt':p.name,'status':'passed'})
assert json.loads((a/'result.json').read_text())['failed']==1
for p in [a,c]:
 assert not [x for x in rows(p/'codex-accept.wire.jsonl') if x.get('method')=='mcpServer/elicitation/request']
 assert next(x for x in rows(p/'mcp-tool-result.jsonl') if x['id']=='codex-accept')['result']=={'action':'decline'}
assert json.loads((c/'result.json').read_text())['passed']==1
checks.append({'id':'codex-never-policy-declines','attempt':c.name,'status':'passed'})
processes=[]
for p in [a,b,c]:
 closed=json.loads((p/'cleanup.json').read_text());assert all(x['exitCode']==0 and x['signal'] is None for x in closed);processes+=closed
assert len(processes)==10
result={'checks':checks,'distinctChecks':len(checks),'nativeProcessesClosed':len(processes),'firstAttemptFailurePreserved':True,'scope':'Offline checks against recorded native HTTP MCP observations, not product acceptance.'}
(root/'audit-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
