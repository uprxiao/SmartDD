# Trusted file/AST analysis only. No model Python/helper import or execution.
from pathlib import Path
import ast,json,re,hashlib,base64,shlex,stat,datetime,urllib.parse
ROOT=Path('/private/tmp/willyou-m12-t121-native-carrier-review-001'); OLD=Path('/private/tmp/willyou-m12-t121-app022-retest-001')
sha=lambda b:hashlib.sha256(b).hexdigest()
rawbytes=(OLD/'raw.private.json').read_bytes(); r=json.loads(rawbytes); c=r['cases'][0]; prefix=c['nativeSnapshotsBeforeStop'][0]; b=Path(prefix['path']).read_bytes(); assert sha(b)=='721432736ce9fcd9594f6dc7cfc15a08dd5121661ad31ae6d8ffc11ffc9991cd'; rows=[json.loads(x) for x in b.decode().splitlines() if x]
parsed=json.loads((ROOT/'parsed-original.private.json').read_text()); extracted=json.loads((ROOT/'tools.private.json').read_text()); entries=extracted['tools']; bycall={x['callId']:x for x in entries}; project=Path(c['projectDir']); helper=project/'.m12-evidence/cli_capture.py'; hs=helper.read_text(); tree=ast.parse(hs); secsrc=(OLD/'fixtures.mjs').read_text().splitlines()[2]; accounts=dict(re.findall(r"\b(qa2?)\s*:\s*'([^']+)'",secsrc)); assert len(accounts)==2; secret=accounts[c['scenario']['account']]; variants=set(accounts.values())|{urllib.parse.quote(v,safe='') for v in accounts.values()}|{urllib.parse.quote_plus(v) for v in accounts.values()}
# Prove the complete actual helper version is the literal AddFile bytes in original115.
patches=extracted['patchTargets']; hp=[x for x in patches if x['path']==str(helper)];assert len(hp)==1 and hp[0]['requestLine']==115 and hp[0]['sha256']==sha(helper.read_bytes())
def dump(n):return ast.dump(n,include_attributes=False)
def template(expr):return dump(ast.parse(expr,mode='eval').body)
runs=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and isinstance(n.func.value,ast.Name) and n.func.value.id=='subprocess'];assert len(runs)==1; run=runs[0];assert run.func.attr=='run' and len(run.args)==1 and isinstance(run.args[0],ast.Name) and run.args[0].id=='command';kw={x.arg:x.value for x in run.keywords};assert set(kw)=={'input','capture_output','text'};assert dump(kw['input'])==template('secret if args.demo_password else None');assert isinstance(kw['capture_output'],ast.Constant) and kw['capture_output'].value is True;assert isinstance(kw['text'],ast.Constant) and kw['text'].value is True
append=[n for n in ast.walk(tree) if isinstance(n,ast.AugAssign) and isinstance(n.target,ast.Name) and n.target.id=='command'];assert len(append)==1 and ast.literal_eval(append[0].value)==['--stdin','value']
assigns=[n for n in ast.walk(tree) if isinstance(n,ast.Assign)];assert any(any(isinstance(t,ast.Name) and t.id=='command' for t in n.targets) and dump(n.value)==template('args.command') for n in assigns);assert any(any(isinstance(t,ast.Name) and t.id=='raw' for t in n.targets) and dump(n.value)==template('result.stdout') for n in assigns);assert any(any(isinstance(t,ast.Name) and t.id=='steps' for t in n.targets) and dump(n.value)==template("json.loads((PRIVATE / 'body.json').read_text())['steps']") for n in assigns)
assert any(isinstance(n,ast.Call) and dump(n.func)==template('match.group') and len(n.args)==1 and ast.literal_eval(n.args[0])==1 for n in ast.walk(tree));assert any(isinstance(n,ast.Call) and dump(n.func)==template('subprocess.run') for n in ast.walk(tree));assert 'env=' not in ast.unparse(run) and 'shell=' not in ast.unparse(run)
# Decode only exact complete JSON metadata blocks. Never scan for JSON in arbitrary text.
meta=re.compile(r'Script completed\nWall time [0-9]+(?:\.[0-9]+)? seconds\nOutput:\n\Z'); mapped=[]; execs=[]; unknown=[]
unknown_ids={x['callId'] for x in parsed['unsupportedCarriers']}; assert len(unknown_ids)==8
for entry in entries:
 output=rows[entry['outputLine']-1]['payload']['output']; assert isinstance(output,list) and output and output[0]['type']=='input_text' and meta.fullmatch(output[0]['text']); tools=entry['tools']; pos=0; results=[]; truncated=any(x.get('type')=='input_text' and x.get('text','').startswith('Warning: truncated output') for x in output[1:])
 if truncated:
  assert entry['callId'] in unknown_ids; assert entry['requestLine'] in [16,85]; unknown.append({'callId':entry['callId'],'requestLine':entry['requestLine'],'outputLine':entry['outputLine'],'reason':'Actual output truncated; numeric child exit and full result not reconstructed','usedForSkillOrBusinessSuccess':False});mapped.append({'callId':entry['callId'],'requestLine':entry['requestLine'],'outputLine':entry['outputLine'],'status':'AST-audited nonbusiness metadata/read calls; output remains unverified','containerPreserved':True,'truncated':True});continue
 for index,block in enumerate(output[1:],1):
  if pos>=len(tools):
   assert block['type']=='input_text'; obs=json.loads(block['text']); assert isinstance(obs,list) and all(isinstance(x,dict) and set(x)<= {'name','description'} for x in obs); results.append({'kind':'readonly-ALL_TOOLS-observer','block':index,'usedForBusiness':False});continue
  t=tools[pos]
  if t['tool']=='view_image':assert block['type']=='input_image';results.append({'kind':'image-observer','block':index,'usedForBusiness':False});pos+=1;continue
  assert block['type']=='input_text'; decoded=json.loads(block['text'])
  if t['tool']=='apply_patch':assert decoded=={};results.append({'kind':'local-apply-patch-empty-result','block':index,'childExitCodeObserved':None,'targetBytesBound':True});pos+=1;continue
  assert t['tool']=='exec_command'
  if isinstance(decoded,dict) and 'i' in decoded:
   assert decoded['status']=='fulfilled'; assert decoded['i']==pos; value=decoded['value']
  else:value=decoded
  assert isinstance(value,dict) and isinstance(value.get('exit_code'),int) and not isinstance(value['exit_code'],bool) and isinstance(value.get('output'),str) and not value.get('session_id'); assert set(value)<= {'chunk_id','wall_time_seconds','exit_code','original_token_count','output'}
  item={'outerCallId':entry['callId'],'toolIndex':pos,'requestLine':entry['requestLine'],'outputLine':entry['outputLine'],'requestAt':entry['requestAt'],'outputAt':entry['outputAt'],'command':t['parameters']['cmd'],'parameters':t['parameters'],'stdout':value['output'],'outerProcessExitCodeObserved':value['exit_code'],'source':prefix['path'],'block':index,'blockSha256':sha(block['text'].encode())};execs.append(item);results.append({k:item[k] for k in ['toolIndex','block','blockSha256','outerProcessExitCodeObserved']});pos+=1
 assert pos==len(tools)
 if entry['callId'] in unknown_ids:mapped.append({'callId':entry['callId'],'requestLine':entry['requestLine'],'outputLine':entry['outputLine'],'status':'finite-actual-literal-AST-and-whole-typed-output-bound','results':results,'inputSha256':entry['inputSha256'],'outputSha256':entry['outputSha256']})
assert len(mapped)==8 and len(unknown)==2
for e in entries:
 for t in e['tools']:
  if t['tool']=='exec_command':
   assert set(t['parameters'])<= {'cmd','max_output_tokens','yield_time_ms','workdir'}
   cmd=t['parameters']['cmd'];assert not any(v in cmd for v in variants);assert not re.search(r'auth\.json|profile-private\.json|(?:printenv|env)\s+WILLYOU_(?:RUN_TOKEN|ENDPOINT)|require_escalated',cmd)
# Full actual Skill reads, only complete indexed results (never truncated16).
skills=[]
for s in c['deliveredSkills']:
 matches=[x for x in execs if s['content'] in x['stdout'] and x['command'].startswith('cat ') and s['path'] in x['command'] and x['outerProcessExitCodeObserved']==0]
 if matches:skills.append({'appId':s['appId'],'skillId':s['skillId'],'completeSingleFileHashMatches':sha(s['content'].encode())==s['sha256'],'reads':[{k:x[k] for k in ['outerCallId','toolIndex','requestLine','outputLine','outerProcessExitCodeObserved','blockSha256']} for x in matches]})
assert all(any(x['appId']==a and x['skillId']==s and any(t['outputLine']<41 for t in x['reads']) for x in skills) for a,s in [('browser','reproduce-bug'),('zentao','bug-analysis'),('browser','browser')])
# Helpers are statically reduced to argv; the original private receipt is original CLI stdout.
helper_calls=[]; recovered=[]
for x in execs:
 cmd=x['command']; assert not any(v in cmd for v in variants)
 if not cmd.startswith('python3 .m12-evidence/cli_capture.py '):continue
 argv=shlex.split(cmd);assert argv[:2]==['python3','.m12-evidence/cli_capture.py'];assert '--name' in argv;name=argv[argv.index('--name')+1];demo='--demo-password' in argv
 if '--sanitize-file' in argv:
  path=Path(argv[argv.index('--sanitize-file')+1]);assert path.resolve()==path and str(path).startswith(r['userData']+'/browser/artifacts/'+c['taskId']+'/');continue
 sep=argv.index('--'); cli=argv[sep+1:];assert cli[0]=='willyou-app';actual=cli+(['--stdin','value'] if demo else []);assert not any(v in arg for v in variants for arg in actual); hfile=project/'.m12-evidence/private'/f'{name}.receipt.json';assert hfile.is_file() and not hfile.is_symlink();vb=hfile.read_bytes();value=json.loads(vb);outer=json.loads(x['stdout']);assert outer['exit']==0 and x['outerProcessExitCodeObserved']==0 and isinstance(outer['receipt'],dict)
 for key in ['schema','status','source','operation','contractMajor','capabilityId']:assert outer['receipt'][key]==value[key]
 assert Path(outer['redactedCopy'])==project/'m12-evidence'/f'{name}.redacted.json';rec={'sourceKind':'actual cli_capture helper/sidecar originalstdout + printedreturncode','outerCallId':x['outerCallId'],'toolIndex':x['toolIndex'],'requestLine':x['requestLine'],'outputLine':x['outputLine'],'cliNumericExitCodeObserved':outer['exit'],'outerProcessExitCodeObserved':x['outerProcessExitCodeObserved'],'argv':actual,'stdinFromResource':demo,'privateReceiptPath':str(hfile),'privateReceiptSha256':sha(vb),'value':value}; recovered.append(rec);helper_calls.append({k:rec[k] for k in rec if k!='value'})
# Combine sources by operation ID, preserving all24 full rows and canonical actor/package/semantics.
receipts={}
for x in parsed['receipts']:
 command=next(z.get('command','') for z in parsed['calls'] if z['callId']==x['callId'] and z['source']==x['source']);direct=command.startswith('willyou-app ') and not re.search(r'[;&|]\s*[^\"\']',command)
 receipts.setdefault(x['value']['operation']['id'],{'value':x['value'],'origin':'direct stockCLI' if direct else 'Python-consumed resource originalreceipt; outer exit not innerCLI exit','callId':x['callId'],'requestLine':x['callLine'],'outputLine':x['line'],'outerProcessExitCodeObserved':x.get('childExitCodeObserved'),'cliNumericExitCodeObserved':x.get('childExitCodeObserved') if direct else None})
for x in recovered:receipts[x['value']['operation']['id']]=x
host=[]
for h in c['hostInvocations']:
 assert h['run_id']==c['actualRunId'] and h['task_id']==c['taskId'] and h['project_id']==c['projectId'] and h['attempt_count']==1 and h['state']=='succeeded';rec=receipts[h['operation_id']];v=rec['value'];assert v['schema']=='willyou-app-result-v2' and v['contractMajor']==2 and v['status']=='ok' and v['capabilityId']==h['tool_name'] and v['source']['appId']==h['app_id'] and v['source']['packageHash']==h['package_hash'];assert v['operation']['id']==h['operation_id'] and v['operation']['requestId']==h['request_id'] and v['operation']['effectState']==h['effect_state'] and v['operation']['origin']=='cli';assert h['effect_state']==('completed' if h['semantics']=='write' else 'read-only');qtime=datetime.datetime.fromisoformat(rows[rec['requestLine']-1]['timestamp'].replace('Z','+00:00'));otime=datetime.datetime.fromisoformat(rows[rec['outputLine']-1]['timestamp'].replace('Z','+00:00'));assert qtime<=datetime.datetime.fromisoformat(h['started_at'].replace('Z','+00:00'))<=datetime.datetime.fromisoformat(h['ended_at'].replace('Z','+00:00'))<=otime;assert any(a['appId']==h['app_id'] and a['packageHash']==h['package_hash'] and a['capabilityId']==h['tool_name'] and a['entry']=='cli' and a['contractMajor']==2 for a in c['actualPlan']['allowed']);host.append({'originalFullRow':h,'proof':{k:rec[k] for k in rec if k!='value'}})
assert len(host)==24 and len(receipts)==24 and len({h['originalFullRow']['request_id'] for h in host})==24
# Resource source and eof are reconstructed from actual original bytes consumed by model code.
get=next(x['value'] for x in parsed['receipts'] if x['value']['capabilityId']=='zentao.object.get');resources=[]
for name in ['body','history']:
 p=project/'.m12-evidence/private'/f'{name}.receipt.json';v=json.loads(p.read_bytes());d=v['data'];ref=get['data'][name];assert d['resourceId']==ref['id'] and d['revision']==ref['revision'] and d['offset']==0 and d['eof'] is True and d['nextOffset'] is None;data=base64.b64decode(d['data']) if d['encoding']=='base64' else d['data'].encode();assert len(data)==ref['size']==d['length'];decoded=project/'.m12-evidence/private'/f'{name}.json';assert decoded.read_bytes()==data;resources.append({'name':name,'resourceId':ref['id'],'revision':ref['revision'],'size':ref['size'],'offset':0,'nextOffset':d['nextOffset'],'eof':True,'operationId':v['operation']['id'],'requestId':v['operation']['requestId'],'decodedFileExact':True,'sourceCallRequestLine':92,'sourceCallOutputLine':95,'numericCLIExitObserved':None,'actualSuccessByReceiptAndHost':True,'noRequireStdoutFullSecret':True})
body=json.loads((project/'.m12-evidence/private/body.json').read_text());match=re.search(r'演示密码[：:]\s*([^\s。；;]+)',body['steps']);assert match and match.group(1)==secret
password=[x for x in helper_calls if x['stdinFromResource']];assert len(password)==1;pw=password[0];assert pw['requestLine']==121 and pw['cliNumericExitCodeObserved']==0 and pw['argv'][:3]==['willyou-app','browser','fill'] and pw['argv'][-2:]==['--stdin','value'];assert '--value' not in pw['argv'];assert not any(v in arg for v in variants for arg in pw['argv']);assert not any(v.encode() in b for v in variants)
# Bind the password reference to the actual original snapshot (not a selector replacement).
origj=json.loads((OLD/'judgement.json').read_text());snap=next(x['value'] for x in parsed['receipts'] if x['value']['capabilityId']=='browser.nav.snapshot' and x['callLine']==105);sb=snap['data'];
if sb.get('file'):sb=next(x['parsed'] for x in origj['artifacts'] if x['operationId']==snap['operation']['id'])
ref=pw['argv'][pw['argv'].index('--element')+1];refs=sb['refs'];refs=list(refs.values()) if isinstance(refs,dict) else refs;assert any(x.get('ref')==ref and re.search('密码|password',x.get('name',''),re.I) for x in refs)
privacy={'fixturePasswordLiteralOrUrlInNative':False,'passwordInAnyParsedCLIArgv':False,'passwordInAnyLiteralCommand':False,'passwordReadFromExactFullBodyResource':True,'passwordOnlyPassedToSubprocessInput':True,'noSubprocessEnvOrShellOverride':True,'processArgvOSObserved':False,'argvStaticallyReconstructedFromExactHelperAndInvocation':True,'helperVersionBoundToOriginalPatch':hp[0],'sourceLineSubprocess':run.lineno,'stdinSourceIsResourceNotPayloadValue':True,'passwordFillOriginalOperationId':next(x['value']['operation']['id'] for x in recovered if x['stdinFromResource']),'pageRefBoundToOriginalSnapshot':True,'secretValueOrIndividualHashPublished':False,'readOnlyM10ResourcePrivateCredentialLegitimateC2':True}
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Only actual T121 carrier/complete24receipts/resource+password transportation; no wholeT121 decision','originalJudgementUnchanged':True,'originalPassed':5,'originalTotal':12,'status':'actual-core-operations-and-password-transport-evidenced-two-truncated-nonbusiness-outputs-unverified','source':{'raw':{'path':str(OLD/'raw.private.json'),'sha256':sha(rawbytes)},'prefix':prefix,'helper':{'path':str(helper),'sha256':sha(helper.read_bytes())}},'actor':{k:c[k] for k in ['projectId','taskId','actualRunId']},'carrierMappings':mapped,'unverifiedOutputsRetained':unknown,'fullSkillReads':skills,'firstBusinessNativeRequestLine':41,'hostReceipts':host,'completeResources':resources,'passwordTransportAndPrivacy':privacy,'Native':0,'App':0,'SQL':0,'HTTP':0,'model':0,'resourcesHeld':[],'formalWholeCaseCount':0};(ROOT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':result['status'],'carrierMappings':len(mapped),'stillTruncatedNonbusinessOutputs':len(unknown),'hostRowsBound':len(host),'resourceEOF':len(resources),'passwordStdinProved':True,'passwordArgvAbsent':True,'wholeT121Judged':False}))
