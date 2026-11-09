"""Offline proof only. Never open originalSource/rollout/DB/auth or execute model code."""
import json, hashlib, re, datetime
from pathlib import Path
ROOT=Path('/private/tmp/willyou-m12-t124-R004-qa-prerequisite-offline-review-001')
R=Path('/private/tmp/willyou-m12-t123-t124-real-R-004')
sha=lambda b:hashlib.sha256(b).hexdigest()
raw_bytes=(R/'raw.json').read_bytes(); raw=json.loads(raw_bytes)
t=raw['tasks'][0];p=t['phases'][0];j=p['journals'][0];sources=[];checks=[]
def source(path,expected=None,size=None):
 path=Path(path);assert path.is_relative_to(R) and '/codex/sessions/' not in str(path)
 b=path.read_bytes();h=sha(b)
 if expected:assert h==expected
 if size is not None:assert len(b)==size
 sources.append({'path':str(path),'sha256':h,'bytes':len(b)});return b
def check(name,condition):assert condition,name;checks.append({'name':name,'pass':True})
native=source(p['nativeOriginal']['path'],p['nativeOriginal']['sha256'],p['nativeOriginal']['bytes'])
check('immutable-full-native-saved-before-parsers',p['nativeOriginal']['savedBeforeParsers'] and Path(p['nativeOriginal']['path']).name.endswith('-full-native.private.jsonl'))
rows=[json.loads(l) for l in native.splitlines()]
meta=rows[0]['payload'];check('immutable-session-meta-original-Native-cwd-provider-version',rows[0]['type']=='session_meta' and meta['id']==t['nativeSessionId'] and meta['cwd']==t['cwd'] and meta['cli_version']=='0.166.0' and meta['model_provider']=='openai')
ack=t['firstACK'];prefix=source(ack['prefixPath'],ack['prefixSha256'],ack['prefixBytes'])
user=rows[ack['line']-1];user_text=''.join(c['text'] for c in user['payload']['content'] if c['type']=='input_text')
check('canonical-once-user-ACK-in-immutable-prefix',native.startswith(prefix) and user['type']=='response_item' and user['payload']['role']=='user' and ack['sourceForm']=='response_item-user-input_text' and ack['messageExact'] and ack['canonicalMessageCount']==1 and len(user_text.encode())==ack['textBytes'] and ack['turnId']==p['promptTurnId'] and ack['nativeSessionId']==t['nativeSessionId'] and ack['cwd']==t['cwd'] and ack['at']>=t['launchedAt'])
# A finite literal grammar for the nine observed text(await tools.METHOD({...})); carriers.
# JSON literals only; no evaluation, interpolation or arbitrary JS fallback.
decoder=json.JSONDecoder()
def literal_object(s,i):
 assert s[i]=='{';i+=1;out={}
 while True:
  while s[i].isspace():i+=1
  if s[i]=='}':return out,i+1
  if s[i]=='"':key,i=decoder.raw_decode(s,i)
  else:
   m=re.match(r'[A-Za-z_][A-Za-z0-9_]*',s[i:]);assert m;key=m[0];i+=len(key)
  assert key not in out and key not in ['__proto__','prototype','constructor']
  while s[i].isspace():i+=1
  assert s[i]==':';i+=1
  while s[i].isspace():i+=1
  value,i=decoder.raw_decode(s,i);out[key]=value
  while s[i].isspace():i+=1
  if s[i]=='}':return out,i+1
  assert s[i]==',';i+=1
def carrier(s):
 children=[];i=0
 while i<len(s):
  while i<len(s) and s[i].isspace():i+=1
  if i==len(s):break
  m=re.match(r'text\(await tools\.(exec_command|write_stdin)\(',s[i:]);assert m,'Unknown outer code';method=m[1];i+=len(m[0]);args,i=literal_object(s,i);assert s[i:i+3]=='));';i+=3
  allowed={'cmd','max_output_tokens','yield_time_ms','tty'} if method=='exec_command' else {'session_id','chars','max_output_tokens','yield_time_ms'}
  assert set(args)<=allowed;children.append((method,args))
 return children
calls=[];outputs={};outer=[]
for line,row in enumerate(rows,1):
 q=row.get('payload',{})
 if q.get('type')=='custom_tool_call':
  assert q['name']=='exec';children=carrier(q['input']);calls.extend((line,q['call_id'],i,m,a) for i,(m,a) in enumerate(children));outer.append({'line':line,'callId':q['call_id'],'inputSHA256':sha(q['input'].encode()),'children':[m for m,a in children]})
 elif q.get('type')=='custom_tool_call_output':
  assert q['call_id'] not in outputs;full=[]
  for index,block in enumerate(q['output']):
   assert block['type']=='input_text'
   if index==0:assert re.fullmatch(r'Script completed\nWall time [0-9.]+ seconds\nOutput:\n',block['text']);continue
   result=json.loads(block['text']);assert isinstance(result,dict) and isinstance(result.get('output'),str);full.append(result)
  outputs[q['call_id']]=(line,full)
 elif q.get('type') in ['function_call','function_call_output']:raise AssertionError('Unexpected unreviewed outer carrier')
check('all-outer-calls-and-full-outputs-exhaustive',len(outer)==9 and len(calls)==10 and len(outputs)==9 and {a['callId'] for a in outer}==set(outputs) and all(len(outputs[o['callId']][1])==len(o['children']) for o in outer))
check('original-journal-child-coverage',len(j['calls'])==10 and len(j['outputs'])==10 and all(any(c['line']==line and c['outerCallId']==cid and c['callIndex']==idx and c['toolName']==method and (method!='exec_command' or c['command']==args['cmd']) for c in j['calls']) for line,cid,idx,method,args in calls))
for o in outer:
 o['outputLine']=outputs[o['callId']][0];o['actualResults']=[{'exitCode':v.get('exit_code'),'runningSession':v.get('session_id'),'outputBytes':len(v['output'].encode()),'outputSHA256':sha(v['output'].encode())} for v in outputs[o['callId']][1]]
typed=[]
for item in p['typedCommands']:
 native_item=rows[item['line']-1]['payload']['item'];assert native_item==item['item'];it=item['item'];assert it['command'][:2]==['/bin/zsh','-lc'] and len(it['command'])==3;assert it['cwd']=='file://'+t['cwd'];assert it['status']=='completed' and type(it['exit_code']) is int and it['exit_code']==0;typed.append((item['line'],it))
skill=t['deliveredSkills'][0];cat=typed[0][1];content=skill['content'].encode()
check('first-non-v2-typed-is-complete-public-Skill-cat',cat['command'][2]=='cat '+skill['path'] and cat['aggregated_output'].encode()==content and outputs[outer[0]['callId']][1][0]['output'].encode()==content and len(content)==skill['bytes']==12402 and sha(content)==skill['sha256']=='15e0337f00488ff43617983a128eee3b808521630dd04f90ed314dde295179e8')
host={h['operation_id']:h for h in p['host']};assert len(host)==len(p['host'])==8 and len({h['request_id'] for h in host.values()})==8
operations=[];values=[]
for line,it in typed[1:]:
 v=json.loads(it['aggregated_output']);values.append(v);op=v['operation'];h=host[op['id']]
 assert v['schema']=='willyou-app-result-v2' and v['status']=='ok' and v['contractMajor']==2 and v['completeness']=={'missing':[],'complete':True} and v['capabilityId']==h['tool_name'] and op['requestId']==h['request_id'] and h['state']=='succeeded' and h['attempt_count']==1 and h['error_code'] is None
 assert h['run_id']==t['runId'] and h['task_id']==t['taskId'] and h['project_id']==t['projectId'] and h['app_id']=='browser' and h['package_hash']==v['source']['packageHash']
 assert any(method=='exec_command' and args['cmd']==it['command'][2] for _,_,_,method,args in calls)
 operations.append({'typedLine':line,'typedCommandId':it['id'],'nativeProcessHandle':it['process_id'],'commandSHA256':sha(it['command'][2].encode()),'actualTypedStatus':it['status'],'actualTypedExitCode':it['exit_code'],'capabilityId':v['capabilityId'],'operationId':op['id'],'requestId':op['requestId'],'runId':h['run_id'],'taskId':h['task_id'],'projectId':h['project_id'],'outputSHA256':sha(it['aggregated_output'].encode()),'hostState':h['state']})
check('eight-unique-Host-operations-and-actual-numeric-typed-exits',len(typed)==9 and len(operations)==8 and {v['operation']['id'] for v in values}==set(host))
stdin=[c for c in calls if c[3]=='write_stdin'];assert len(stdin)==1
line,cid,index,_,args=stdin[0];chars=args['chars'];assert len(chars)>2 and chars.endswith('\n\x04') and '\n' not in chars[:-2] and '\x04' not in chars[:-2]
origin=[c for c in calls if c[3]=='exec_command' and c[4].get('tty') is True];assert len(origin)==1
origin_line,origin_cid,_,_,origin_args=origin[0];cmd=origin_args['cmd'];assert re.fullmatch(r"stty -echo; cat \| willyou-app browser fill --element '[^']+' --stdin value; result=\$\?; stty echo; exit \$result",cmd)
check('every-outer-child-has-actual-numeric-zero-or-one-bound-running-origin',all((cid0==origin_cid and 'exit_code' not in v and v['session_id']==84958) or (type(v.get('exit_code')) is int and v['exit_code']==0) for cid0,(_,results) in outputs.items() for v in results))
check('synthetic-secret-only-one-nonempty-LF-single-EOT-stdin-delivery',all(chars[:-2] not in a['cmd'] for _,_,_,m,a in calls if m=='exec_command') and outputs[origin_cid][1][0].get('session_id')==args['session_id']==84958 and outputs[cid][1][0]['exit_code']==0 and len(j['stdinProofs'])==1 and j['stdinProofs'][0]['fixtureSecretExact'] and j['stdinProofs'][0]['singleDelivery'])
chain=j['sessionChains'][0];fill=json.loads(outputs[cid][1][0]['output']);assert chain['originCallId']==origin_cid and chain['terminal']['callId']==cid and chain['terminal']['exitCode']==0 and chain['businessTerminalEvidence']['operationId']==fill['operation']['id'] and chain['businessTerminalEvidence']['requestId']==fill['operation']['requestId'] and chain['businessTerminalEvidence']['childExitCodeObserved']==0
failure=p['directTyped']['failures'];check('compound-parser-failure-preserved-and-completed-by-direct-native-chain',len(failure)==1 and failure[0]['line']==48 and failure[0]['reason']=='shell operator/expansion not accepted' and failure[0]['operationId']==fill['operation']['id'] and failure[0]['requestId']==fill['operation']['requestId'] and next(it for l,it in typed if l==48)['exit_code']==0)
contexts=[(i+1,z['payload']) for i,z in enumerate(rows) if z['type']=='turn_context'];check('all-contexts-exact-model-approval-sandbox',len(contexts)==1 and all(z['model']=='gpt-6.1-sol' and z['approval_policy']=='on-request' and z['sandbox_policy']['type']=='workspace-write' and z['cwd']==t['cwd'] and z['turn_id']==p['promptTurnId'] for _,z in contexts))
unsafe=['malformed','forbiddenEscalations','unmatchedOutputs','unexpectedReceipts','environmentAttempts','credentialAccessAttempts','unsupportedCarriers','unsupportedOutputs','duplicateCalls','duplicateOutputs','pendingCallIds','outputBeforeCalls','invalidTimestamps','sessionIssues','approvalRequests']
check('all-known-unsafe-unknown-and-pending-arrays-empty',all(j[k]==[] for k in unsafe) and p['originalOuter']['unsupportedCarriers']==[] and p['originalOuter']['unsupportedOutputs']==[] and len(p['directTyped']['outerRecords'])==18 and not p['directTyped']['modelCodeEvaluated'])
pre=next(v['data'] for v in values if v['capabilityId']=='browser.nav.snapshot');post=[v['data'] for v in values if v['capabilityId']=='browser.nav.snapshot'][-1];profile=next(v['data']['result'] for v in values if v['capabilityId']=='browser.profile.show');prereq=raw['cases']['T124']['precondition'];tab=p['workspace']['tabs'][0]
check('same-original-page-project-profile-task-and-run',len(p['workspace']['tabs'])==1 and pre['browserPageId']==post['browserPageId']==profile['browserPageId']==tab['id']==prereq['pageId'] and profile['profileId']==tab['profileId']==prereq['projectProfileId'] and prereq['peerTaskId']==t['taskId'] and p['identity']['taskId']==t['taskId'] and p['identity']['runId']==t['runId'] and p['identity']['nativeSessionId']==t['nativeSessionId'])
refs={v['name']:v['ref'] for v in pre['refs']};check('finite-AX-login-controls-then-real-account-snapshot',all(n in refs for n in ['账号','密码','登录']) and refs['账号'] in typed[5][1]['command'][2] and refs['密码'] in cmd and refs['登录'] in typed[7][1]['command'][2] and '当前账号：' in post['snapshot'] and 'StaticText "qa"' in post['snapshot'])
http_file=next(f['logPath'] for f in raw['fixtureFinal'] if f['caseId']=='T124');http=source(http_file);requests=[json.loads(l) for l in http.splitlines()];assert requests==p['siteRequests'];login=[v for v in requests if v['method']=='POST' and v['path']=='/site/login'];check('immutable-HTTP-POST-qa-303-and-authenticated-GET',len(login)==1 and login[0]['status']==303 and login[0]['account']=='qa' and any(v['method']=='GET' and v['path']=='/site' and v['account']=='qa' and v['status']==200 and v['at']>=login[0]['at'] for v in requests))
clean_bytes=source(R/'cleanup.json');clean=json.loads(clean_bytes);check('normal-exit-and-independent-14-11-2-1-clear',raw['appExit']['code']==0 and raw['appExit']['signal'] is None and raw['observedProcess']['signals']==[] and raw['cleanupErrors']==[] and clean['allClear'] and len(clean['processes'])==14 and all(v['absent'] for v in clean['processes']) and len(clean['ports'])==11 and all(v['absent'] for v in clean['ports']) and len(clean['unix'])==2 and all(v['socket']['absent'] and v['parent']['absent'] for v in clean['unix']) and len(clean['helpers'])==1 and clean['helpers'][0]['clear'])
check('focus-stopped-before-main-trusted-UI-launch-no-cause-inference',raw['status']=='deferred-focus-loss' and raw['failure']['stage']=='T124-main-trusted-ui-launch' and raw['focusGuard']['state']['focused'] is False and raw['focusGuard']['state']['ownedWindowFocused'] is False)
out={'schema':'R004-qa-prerequisite-independent-offline-audit-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'qa-prerequisite-proof-verified-not-full-T124-pass','checks':checks,'scope':'R004 immutable precondition only. No R005 source/input/userData/DB/Cookie/auth or mutable rollout opened. No model code evaluated or processes/network launched.','rawSHA256':sha(raw_bytes),'sourcePins':{'approvedPayloadBundleSHA256':raw['payloadSHA256'],'source029ManifestSHA256':raw['sourceManifestSHA256'],'ASARSHA256':raw['asarSHA256'],'canonicalUserBytes':len(user_text.encode()),'canonicalUserSHA256':sha(user_text.encode()),'deliveredPublicSkillBytes':12402,'deliveredPublicSkillSHA256':skill['sha256']},'originalIdentity':{k:t[k] for k in ['taskId','runId','ptyId','nativeSessionId','projectId','cwd']},'pageProfile':prereq,'outer':outer,'operations':operations,'stdin':{'originLine':origin_line,'originCallId':origin_cid,'deliveryLine':line,'deliveryCallId':cid,'sessionId':args['session_id'],'tty':True,'nonemptySecretPrefix':True,'characters':len(chars),'suffixCodepoints':[10,4],'nonemptyDeliveries':1,'actualWriteStdinExitCode':0,'operationId':fill['operation']['id'],'requestId':fill['operation']['requestId'],'secretValuePublished':False},'directTypedCollectorBoundary':{'originalFailuresPreserved':failure,'classification':'Simple command parser does not accept the compound stdin carrier. Actual typed line48 is completed numeric0; actual full write_stdin line49 numeric0 and original sessionChains bind same unique Host op/request. No exit manufactured or gate relaxed.'},'contexts':[{'line':l,'model':z['model'],'approval':z['approval_policy'],'sandbox':z['sandbox_policy']['type']} for l,z in contexts],'unsafeCounts':{k:len(j[k]) for k in unsafe},'AX':{'before':pre['snapshot'],'after':post['snapshot']},'HTTP':requests,'focusStop':{'failure':raw['failure'],'guard':raw['focusGuard'],'cause':'unknown','lateObservationBoundary':'Later iTerm2 observation is not contemporaneous evidence of the cause before cleanup; no causal claim made.'},'exit':{'app':raw['appExit'],'observed':raw['observedProcess'],'cleanupCounts':{'PID':14,'TCP':11,'Unix':2,'helper':1},'allClear':True},'formalNewPasses':0,'resourcesHeld':False}
(ROOT/'audit.safe.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');(ROOT/'sources.safe.json').write_text(json.dumps({'raw':{'path':str(R/'raw.json'),'sha256':sha(raw_bytes),'bytes':len(raw_bytes)},'immutableFilesRead':sources,'mutableOriginalSourceNotOpened':p['nativeOriginal']['originalSource'],'noR005FilesRead':True},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':out['status'],'checks':len(checks),'outer':len(outer),'Host':len(operations),'sourceFiles':len(sources),'formalNewPasses':0}))
