from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent;native=json.loads((p/'latest.json').read_text());replay=json.loads((p/'replay-latest.json').read_text());n=Path(native['out']);sha=lambda b:hashlib.sha256(b).hexdigest();checks=[]
assert len(replay['results'])==12 and all(x['status']=='passed' for x in replay['results'])
for driver in ['claude','codex']:
 r=json.loads((n/(driver+'-result.json')).read_text());records=r['records'];assert len(records)==3 and len({x['text'] for x in records})==1 and len({x['inputId'] for x in records})==3;assert [x['source'] for x in records]==['ui-user','ui-user','agent-delegation'];raw=[json.loads(x) for x in (n/(driver+'-native.jsonl')).read_text().splitlines()];wire=[json.loads(x) for x in (n/(driver+'-wire.jsonl')).read_text().splitlines()]
 for x in records:
  if driver=='claude':
   m=[v for v in raw if v.get('type')=='user' and v.get('uuid')==x['inputId']];assert len(m)==1 and m[0]['message']['content']==x['text'];assert m[0].get('isMeta') is not True
   response=[v for v in wire if v.get('type')=='result' and v.get('user_message_uuid')==x['inputId']];assert len(response)==1 and response[0]['is_error'] is False
  else:
   response=[v for v in wire if v.get('method')=='item/completed' and v.get('params',{}).get('item',{}).get('clientId')==x['inputId']];assert len(response)==1
   turn=response[0]['params']['turnId'];m=[v for v in raw if v.get('type')=='response_item' and v.get('payload',{}).get('role')=='user' and v['payload'].get('internal_chat_message_metadata_passthrough',{}).get('turn_id')==turn and v['payload'].get('content')==[{'type':'input_text','text':x['text']}]];assert len(m)==1
   assert m[0]['payload']['id']!=response[0]['params']['item']['id'];assert x['inputId'] not in json.dumps(m[0]);assert m[0]['payload']['internal_chat_message_metadata_passthrough']['content_item_metadata']==[{'provenance':{'type':'user'}}]
 checks.append({'driver':driver,'records':3,'sourceWasNotDistinguishedByNativeUserRole':True})
closed=json.loads((n/'cleanup.json').read_text());assert len(closed)==2 and all(x['exitCode']==0 and x['signal'] is None for x in closed)
for b in json.loads((p/'build.json').read_text())['builds']:
 assert sha(Path(b['output']).read_bytes())==b['sha256']
 for s in b['sources']:assert sha(Path(s['path']).read_bytes())==s['sha256'],s['path']
result={'nativeChecks':checks,'nativeProcessesClosed':2,'nativeTurns':6,'replayChecks':12,'sourceHashes':'unchanged','boundary':'Candidate provenance is not a mail grant; sender, active run and capability compatibility are controlled replay fixtures, not product integration.'};(p/'audit-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
