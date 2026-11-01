import json,sqlite3,hashlib
from pathlib import Path

def result(value,depth=0):
 if depth>12:return None
 if isinstance(value,dict):
  if value.get('schema')=='willyou-app-result-v2':return value
  for v in value.values():
   found=result(v,depth+1)
   if found:return found
 elif isinstance(value,list):
  for v in value:
   found=result(v,depth+1)
   if found:return found
 elif isinstance(value,str):
  for text in [value,*value.splitlines()]:
   try:found=result(json.loads(text),depth+1)
   except (ValueError,TypeError):continue
   if found:return found
 return None
for root,kind in [('/private/tmp/willyou-m11-s7-native-xgnivp','stopReplay'),('/private/tmp/willyou-m11-s7-native-jo730n','restart')]:
 p=Path(root);d=json.load((p/'result.json').open());r=d[kind];after=r['after'];plan=after.get('plan');run=plan['runId'] if plan else after['runId'];task=after['taskId'];rawAfter=after.get('actual',after.get('actualCapabilityResult'));outputs=[v for v in d['nativeToolOutputs'] if v.get('type')=='function_call_output'];c=sqlite3.connect('file:'+str(p/'userdata/smartdd.db')+'?mode=ro&immutable=1',uri=True);c.row_factory=sqlite3.Row;rows=[]
 for output in outputs:
  value=result(output);assert value
  row=dict(c.execute('SELECT operation_id,run_id,task_id,app_id,state,started_at FROM application_data_operations WHERE operation_id=?',(value['operation']['id'],)).fetchone());rows.append({'callId':output['call_id'],'value':value,'ledger':row})
 c.close();current=[v for v in rows if v['ledger']['run_id']==run and v['ledger']['task_id']==task];assert len(current)==1 and current[0]['ledger']['state']=='succeeded';assert current[0]['value']['data']['items'][0]['id']=='79291';assert current[0]['value']['operation']['id']!=rawAfter['operation']['id'];assert len(outputs)==2
 review={'schema':'m11-renewed-operation-readonly-correction-v1','scope':'No App/CLI/send/replay restarted; closed SQLite immutable=1 read-only and original native function_call_output carriers only.','originalResultSha256':hashlib.sha256((p/'result.json').read_bytes()).hexdigest(),'originalCommandStatusPreserved':d['status'],'driverDefect':'Call IDs reused across original/resumed turns. Original computed after.actual selected the earlier success from both retained outputs; actual new read did execute and its later original output is independently tied to the new run.','originalReportedAfterOperationId':rawAfter['operation']['id'],'verifiedCurrentRunId':run,'verifiedCurrentActual':current[0],'bothOriginalOutputs':rows,'actualNewProviderReadProvedByOriginalDelta':True,'newDriverFix':'Unique call IDs per turn, filter function_call_output, select current output and assert operation_id belongs to current run/task. No new business execution for this correction.','diagnosticPreflightErrors':['First read-only query assumed status column; absent.','Second read-only query assumed created_at; PRAGMA showed started_at. Corrected SELECT uses actual schema; no mutation.']};(p/'renewed-operation-audit.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n');print(p.name,'verified new operation',current[0]['ledger']['operation_id'],'run',run)
