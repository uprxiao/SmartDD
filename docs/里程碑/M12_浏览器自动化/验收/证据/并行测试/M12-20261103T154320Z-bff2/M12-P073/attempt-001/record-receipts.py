#!/usr/bin/python3
# Read actual post-exit private SQLite; never answers a dialog or modifies data.
import json,sqlite3
from pathlib import Path
root=Path('/private/tmp/willyou-m12-p073-dialog-boundaries-native-001')
raw=json.loads((root/'raw.json').read_text());host=json.loads((root/'host-initial.raw.json').read_text())
connection=sqlite3.connect('file:'+str(root/'runtime-001/userdata/p070.sqlite')+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row
run_id=raw['ready']['runs'][0]['runId'];records=[]
for step in raw['steps']:
 value=step.get('parsed',{});op=value.get('operation')or{};op_id=op.get('id')or value.get('operationId');request_id=op.get('requestId')or value.get('requestId')
 row={'label':step['label'],'actualCliCode':step.get('raw',{}).get('code'),'actualOperationEnvelope':op or None,'actualErrorMetadata':value.get('error')}
 if op_id and request_id:
  row['invocation']=dict(x)if(x:=connection.execute('SELECT operation_id,run_id,request_id,state,attempt_count,effect_state,error_code FROM application_invocations WHERE operation_id=? AND run_id=? AND request_id=?',(op_id,run_id,request_id)).fetchone())else None
  row['dataOperation']=dict(x)if(x:=connection.execute('SELECT operation_id,run_id,state,attempt_count,error_code,action FROM application_data_operations WHERE operation_id=? AND run_id=?',(op_id,run_id)).fetchone())else None
  row['browserRecords']=[dict(x)for x in connection.execute('SELECT run_id,request_id,command,state,effect_state,error_code,created_at,updated_at FROM browser_operations WHERE run_id=? AND request_id IN (?,?)',(run_id,request_id,'audit:'+request_id))]
 records.append(row)
connection.close()
result={'origin':'ActualCLIenvelope+readonlypost-exitSQL, no synthetic attemptCount','runId':run_id,'records':records,'actualHelperSpawns':host.get('helperSpawns'),'helperObserverRestored':host.get('helperObserverRestored'),'boundary':'Helper cold verified by passive unmodifiedexecFile delegation+realstate. No driverCDP/userAPI answer. P073A exactnewoperations judged independently; no originalbasiccase replay.'}
(root/'receipt-metadata.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'records':len(records),'helperSpawns':len(result['actualHelperSpawns']or[]),'actualOnly':True}))
