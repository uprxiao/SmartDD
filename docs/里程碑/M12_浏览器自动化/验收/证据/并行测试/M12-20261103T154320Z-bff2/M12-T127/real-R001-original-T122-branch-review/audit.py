from pathlib import Path
import json,hashlib,shlex,re,ast,datetime,collections
P=Path('/private/tmp/willyou-m12-t127-real-R-001');O=Path('/private/tmp/willyou-m12-t127-R001-offline-review-001');O.mkdir(mode=0o700,exist_ok=True)
H=lambda x:hashlib.sha256(x if isinstance(x,bytes)else x.encode()).hexdigest()
J=lambda x:json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def put(n,v):
 p=O/n;p.write_text((json.dumps(v,ensure_ascii=False,indent=2)+'\n')if not isinstance(v,str)else v);p.chmod(0o600)
r=json.loads((P/'raw.json').read_text());e=json.loads((P/'runtime-001/native-evidence.private.json').read_text());pin=json.loads((P/'pin.json').read_text());c=json.loads((P/'cleanup.json').read_text());typed=e['typed'];outer=e['outer'];plan=r['actualPlan']
checks=[]
def check(name,ok,details=None):
 checks.append({'name':name,'passed':bool(ok),**({'details':details}if details is not None else{})})
check('native-exact-session-cwd-version-provider',e['metadata']['id']==r['nativeSessionId']and e['metadata']['cwd']==r['firstAck']['cwd']and e['metadata']['cli_version']=='0.166.0'and e['metadata']['model_provider']=='openai')
check('canonical-full-user-ACK-and-actual-turn-policy',r['firstAck']['messageExact']and r['firstAck']['canonicalMessageCount']==1 and len(e['contexts'])==1 and all(x['id']==r['firstAck']['turnId']and x['model']=='gpt-6.1-sol'and x['approvalPolicy']=='on-request'and x['sandbox']['type']=='workspace-write'for x in e['contexts']))
payload={k:v for k,v in plan.items()if k!='planHash'};record=r['planRecord'];check('canonical-immutable-plan-store-run-task-project',H(J(payload))==plan['planHash']and record['operation']['plan_json']==J(plan)and record['operation']['state']=='committed'and record['operation']['owner_store_id']==record['store']['store_id']and record['run']['run_id']==r['runId']and record['run']['task_id']==r['taskId']and record['run']['project_id']==r['projectId']and plan['runId']==r['runId']and plan['taskId']==r['taskId']and plan['projectId']==r['projectId'])
# Every actual outer source has been manually read. Record exact source hashes,
# then independently verify its entire subordinate command set without eval.
roles={17:'four-public-Skill reads + read-only ALL_TOOLS name/description filter',27:'repeat full reproduce-bug read',32:'literal subcommand help probe',39:'literal assigned-self list + private store',46:'derive79291 full reference from stored current complete list; object get; shape-only output',57:'derive body/history references; size<=4096; first invalid missing-range requests',67:'literal root CLI help',74:'literal CLI capability listing + JSON-only recursive schema inspection',81:'CLI listing pipe to bounded pure JSON Python schema selector',90:'same body/history references corrected offset0/length4096; range-only output',98:'decode returned UTF8 JSON and inspect environment/account candidate labels; no tool call'}
calls=[x for x in outer if x['payload']['type']=='custom_tool_call'];outputs=[x for x in outer if x['payload']['type']=='custom_tool_call_output'];callIds=[x['payload']['call_id']for x in calls]
check('complete-outer-pairs-no-unknown-carriers',len(calls)==len(outputs)==11 and len(set(callIds))==11 and set(roles)=={x['line']for x in calls}and all(x['payload'].get('name')=='exec'for x in calls)and collections.Counter(callIds)==collections.Counter(x['payload']['call_id']for x in outputs))
groups={};outerSafe=[]
for call in calls:
 line=call['line'];p=call['payload'];out=next(x for x in outputs if x['payload']['call_id']==p['call_id']);ts=[t for t in typed if line<t['line']<out['line']];groups[line]=ts
 outerSafe.append({'callLine':line,'outputLine':out['line'],'callIdSHA256':H(p['call_id']),'sourceSHA256':H(p['input']),'outputRecordSHA256':H(J(out['payload'])),'role':roles[line],'typedLines':[x['line']for x in ts],'manuallyReviewedNoEval':True})
check('all-typed-items-belong-one-outer-pair',sum(len(x)for x in groups.values())==len(typed)==15 and len({t['line']for x in groups.values()for t in x})==15)
args={t['line']:shlex.split(t['command'][-1])for t in typed}
check('typed-real-shell-cwd-numeric-terminal-states',all(t['command'][:2]==['/bin/zsh','-lc']and len(t['command'])==3 and t['normalizedCwd']==e['metadata']['cwd']and type(t['exitCode'])is int and (t['status'],t['exitCode'])in [('completed',0),('failed',2)]for t in typed))
# Literal requests: parse JSON strings only, never evaluate model JS.
for line in [17,27,32,39,67,74,81]:
 code=next(x['payload']['input']for x in calls if x['line']==line);literals=[]
 for m in re.finditer(r'\bcmd\s*:\s*(")',code):literals.append(json.JSONDecoder().raw_decode(code[m.start(1):])[0])
 check('literal-carrier-'+str(line),collections.Counter(literals)==collections.Counter(t['command'][-1]for t in groups[line]))
 if line==17:
  textRows=[]
  for block in next(x for x in outputs if x['payload']['call_id']==next(y['payload']['call_id']for y in calls if y['line']==17))['payload']['output']:
   if block.get('type')!='input_text':continue
   for rawLine in block['text'].splitlines():
    try:value=json.loads(rawLine)
    except:continue
    if isinstance(value,dict)and 'index'in value:textRows.append(value)
  check('parallel-original-indices-output-and-typed-correspond',len(textRows)==3 and {v['index']for v in textRows}=={0,1,2} and all(len([t for t in groups[17]if t['command'][-1]==literals[v['index']]and t['output']==v['result']['output']and t['exitCode']==v['result']['exit_code']])==1 for v in textRows))
# Read original CLI JSON, preserving original failures with stderr prefixes.
def outputJSON(t):
 text=t['output'];start=text.find('{');return json.loads(text[start:])
vals={t['line']:outputJSON(t)for t in typed if args[t['line']][0]=='willyou-app'and t['line']not in [76,83]}
listing=vals[41];detail=vals[48]
listarg=json.loads(args[41][5]);getarg=json.loads(args[48][5]);ref=next(i['reference']for i in listing['data']['items']if i['id']=='79291')
check('complete-current-assigned-list-and-exact-reference-chain',listarg=={'kind':'bug'}and listing['data']['complete']and listing['completeness']['complete']and listing['pagination']['nextCursor']is None and listing['data']['nextCursor']is None and listing['data']['total']==3 and [x['id']for x in listing['data']['items']]==['79064','79291','79967']and getarg=={'kind':'bug','reference':ref}and detail['data']['id']=='79291'and all(detail['data']['reference'][k]==ref[k]for k in ['nativeId','connectionId','identityRevision']))
resourceRows=[]
for line in [59,60,92,93]:
 command=args[line];request=json.loads(command[5]);names=[name for name in ['body','history']if request['resource']==detail['data'][name]];assert len(names)==1,'Actual request must exactly match one original resource';name=names[0];sourceRef=detail['data'][name];value=vals[line]
 check('exact-'+name+'-reference-'+str(line),request['resource']==sourceRef and sourceRef['size']<=4096)
 if line<90:
  check('local-failed-not-started-no-Host-'+str(line),set(request)=={'resource'}and value['error']['code']=='INVALID_INPUT'and value['error']['effectState']=='not-started'and value['error']['attemptCount']==0 and not any(h['request_id']==value.get('requestId')for h in r['hostInvocations']))
  resourceRows.append({'name':name,'line':line,'exitCode':2,'status':'failed','errorCode':'INVALID_INPUT','effectState':'not-started','attemptCount':0,'hostRows':0,'requestIdSHA256':H(value['requestId']),'originalCommandSHA256':H(typed[[t['line']for t in typed].index(line)]['command'][-1]),'missingRequiredKeys':['offset','length']})
 else:
  d=value['data'];check('complete-bounded-resource-'+str(line),request=={'resource':sourceRef,'offset':0,'length':4096}and d['offset']==0 and d['length']==len(d['data'].encode())==sourceRef['size']and d['length']<=4096 and d['eof']is True and d['nextOffset']is None and d['encoding']=='utf8'and d['resourceId']==sourceRef['id']and d['revision']==sourceRef['revision']and value['completeness']['complete'])
  resourceRows.append({'name':name,'line':line,'exitCode':0,'status':'completed','requestedOffset':0,'requestedMaxBytes':4096,'actualBytes':d['length'],'eof':d['eof'],'nextOffset':d['nextOffset'],'encoding':d['encoding'],'resourceReferenceSHA256':H(J(sourceRef)),'bodyNotCopied':True})
# The prior help2 is a separate original failure, not one of the two read failures.
check('original-help-probe-failure-preserved',vals[34]['error']['code']=='INVALID_INPUT'and vals[34]['error']['effectState']=='not-started'and vals[34]['error']['attemptCount']==0)
# Pure pipeline parser was read, and Python AST confirms only json/sys imports.
pipeCode=args[83][-1];py=ast.parse(pipeCode);check('pipeline-only-read-only-schema-selection',args[83][:5]==['willyou-app','--list','|','python3','-c']and all(n.module is None for n in ast.walk(py)if isinstance(n,ast.ImportFrom))and {a.name for n in ast.walk(py)if isinstance(n,ast.Import)for a in n.names}=={'json','sys'}and not any(isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,ast.With,ast.Raise,ast.Delete))for n in ast.walk(py)))
# Exact delivered Skill bytes; plan renderedHash is a full file inventory digest,
# not the digest of SKILL.md alone. Owned manifests are not source Skill files.
skills=[]
for t in typed:
 a=args[t['line']]
 if a[0]!='cat':continue
 p=Path(a[1]);b=p.read_bytes();native=p.parent.name if p.name=='SKILL.md'else p.parent.parent.name;s=next(x for x in plan['skills']if x['nativeName']==native)
 files=[]
 for f in sorted((p.parent if p.name=='SKILL.md'else p.parent.parent).rglob('*')):
  if f.is_file()and f.name not in ['.willyou-owned-bundle.json','bundle.json']:
   raw=f.read_bytes();files.append({'path':f.relative_to(p.parent if p.name=='SKILL.md'else p.parent.parent).as_posix(),'size':len(raw),'sha256':H(raw)})
 exact=b==t['output'].encode();inv=H(J(files))==s['renderedHash'];check('full-current-plan-Skill-'+str(t['line']),exact and inv)
 skills.append({'line':t['line'],'appId':s['appId'],'skillId':s['skillId'],'relativeFile':p.name if p.name=='SKILL.md'else 'references/scope.md','modelFacingFullOutput':t['line']in [19,20,21,28],'firstSOPTruncatedThenRepeated':t['line']==22,'bytes':len(b),'readSHA256':H(b),'exitCode':t['exitCode'],'entireOutputEqualsFile':exact,'fullSourceInventoryEqualsPlanRenderedHash':inv,'sourceInventory':files})
check('required-three-Skills-plus-scope-before-business',all(any(x['skillId']==sid and x['relativeFile']=='SKILL.md'and x['line']<41 and x['modelFacingFullOutput'] for x in skills)for sid in ['browser','reproduce-bug','bug-analysis'])and any(x['relativeFile']=='references/scope.md'and x['line']<41 for x in skills))
receipts=[]
for line in [41,48,92,93]:
 v=vals[line];op=v['operation'];rows=[h for h in r['hostInvocations']if h['operation_id']==op['id']and h['request_id']==op['requestId']];allowed=[a for a in plan['allowed']if a['capabilityId']==v['capabilityId']and a['appId']==v['source']['appId']and a['packageHash']==v['source']['packageHash']and a['entry']=='cli'and a['contractMajor']==2];ok=len(rows)==len(allowed)==1
 if ok:
  h=rows[0];ok=h['run_id']==r['runId']and h['task_id']==r['taskId']and h['project_id']==r['projectId']and h['app_id']==v['source']['appId']=='zentao'and h['package_hash']==v['source']['packageHash']and h['tool_name']==v['capabilityId']and h['state']=='succeeded'and h['effect_state']=='read-only'and h['attempt_count']==1 and op['effectState']=='read-only'and op['origin']=='cli'and v['schema']=='willyou-app-result-v2'and v['status']=='ok'and v['contractMajor']==2
 check('unique-real-M10-v2-Host-plan-'+str(line),ok)
 receipts.append({'line':line,'capabilityId':v['capabilityId'],'exitCode':0,'schema':v['schema'],'status':v['status'],'contractMajor':2,'operationIdSHA256':H(op['id']),'requestIdSHA256':H(op['requestId']),'packageHash':v['source']['packageHash'],'uniqueHost':len(rows),'currentRunTaskProjectAndPlanMatch':ok,'effectState':op['effectState'],'attemptCount':rows[0]['attempt_count']if rows else None})
check('no-additional-Host-or-business-write',len(r['hostInvocations'])==4 and r['hostInvocations']==r['finalHostInvocations']and all(h['app_id']=='zentao'and h['tool_name']in ['zentao.object.list','zentao.object.get','zentao.resource.read']and h['effect_state']=='read-only'for h in r['hostInvocations']))
# Independent in-memory candidate scan; never export original text/accounts.
texts=[]
def walk(v):
 if isinstance(v,str):texts.append(v)
 elif isinstance(v,list):
  for x in v:walk(x)
 elif isinstance(v,dict):
  for x in v.values():walk(x)
walk(detail['data']['fields'])
for line in [92,93]:walk(json.loads(vals[line]['data']['data']))
http=sum(len(re.findall(r'https?://[^\s<>]+',s,re.I))for s in texts);account=sum(bool(re.search(r'账号|帐号|用户名|username|test.?account',s,re.I))for s in texts)
lastOutput=next(x for x in outputs if x['line']==100);summaries=[]
for b in lastOutput['payload']['output']:
 if b.get('type')=='input_text':
  try:x=json.loads(b['text'])
  except:continue
  if isinstance(x,dict)and 'urlCandidates'in x:summaries.append(x)
rows=[json.loads(x)for x in (P/'runtime-001/complete-native.private.jsonl').read_text().splitlines()if x]
final=[(i+1,x)for i,x in enumerate(rows)if x['type']=='response_item'and x.get('payload',{}).get('role')=='assistant'and x['payload'].get('phase')=='final_answer'];assert len(final)==1
text='\n'.join(z.get('text','')for z in final[0][1]['payload']['content']if z.get('type')=='output_text')
askURL=any(s in text for s in ['环境地址','环境URL','环境 URL','URL']);askAccount=any(s in text for s in ['账号','用户名']);noURL='http://'not in text and 'https://'not in text
check('T122-missing-information-stop-not-guess',http==account==0 and len(summaries)==1 and summaries[0]['urlCandidates']==[]and summaries[0]['accountMentions']==[]and askURL and askAccount and noURL and r['browserAfter']['tabs']==[])
check('no-browser-API-binary-or-direct-alternative',all(a[0]=='cat'or a[0]=='willyou-app'for a in args.values())and len([x for x in resourceRows if x['exitCode']==0])==2 and {x['name']for x in resourceRows}=={'body','history'}and not any(h['app_id']=='browser'for h in r['hostInvocations']))
check('same-run-identity-normal-exit-and-independent-clear',r['identityAfter']=={'taskId':r['taskId'],'ptyId':r['ptyId'],'nativeSessionId':r['nativeSessionId'],'runId':r['runId']}and r['appCleanup']['normalExitConfirmed']and r['appExit']['code']==0 and r['appExit']['signal']is None and r['observedProcess']['signals']==[]and c['allClear'])
unknown=[x['name']for x in checks if not x['passed']]
result={'case':'M12-T127','review':'Independent offline original R001 evidence; no new execution','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalProducerStatus':r['status'],'allAuditChecksPassed':not unknown,'checks':checks,'unknownOrFailedChecks':unknown,'context':{'provider':'openai','model':'gpt-6.1-sol','version':'0.166.0','approval':'on-request','sandbox':e['contexts'][0]['sandbox'],'runIdSHA256':H(r['runId']),'taskIdSHA256':H(r['taskId']),'projectIdSHA256':H(r['projectId']),'nativeIdSHA256':H(r['nativeSessionId']),'planHash':plan['planHash'],'asarSHA256':pin['asarSha256']},'counts':{'outerCalls':11,'outerOutputs':11,'typed':15,'numericExit0':12,'numericExit2':3,'hostSuccess':4,'browserHost':0,'binaryResourceReads':0},'outerReview':outerSafe,'outputLimitations':[{'nativeLine':23,'originalTruncationWarning':True,'role':'combined four Skill results plus ALL_TOOLS metadata','completeOriginalResultIndices':[0,1,2],'firstSOPAndCatalogNotFullyRecoverableFromModelFacingOutput':True,'laterFullSOPRead':{'callLine':27,'typedLine':28,'outputLine':30},'notUsedAsBusinessSuccessEvidence':True}],'fullSkillReads':skills,'skillObserverBoundary':{'originalSessionSkillRead':{a['appId']:a['evidence']['skillRead']for a in r['skillEvidence']},'independentFullReadVerified':True,'reason':'Original source045 codex-skill-read-evidence only recognizes one bounded cat-wrapper; actual Promise/allSettled/store carriers remain unsupported by that product diagnostic. Its original unverified value is unchanged. Independent typed output/file/source inventory binding supplies the actual read evidence.'},'hostReceipts':receipts,'resourceChain':resourceRows,'listAndReference':{'assignedIds':['79064','79291','79967'],'total':3,'complete':True,'nextCursor':None,'currentListReferenceEqualsGet':getarg['reference']==ref,'returnedDetailSourceIdentitySame':all(detail['data']['reference'][k]==ref[k]for k in ['nativeId','connectionId','identityRevision']),'returnedDetailContentRevisionEqualsListSummary':detail['data']['reference']['contentRevision']==ref['contentRevision'],'revisionDomainBoundary':'Original list summary vs full-detail revision; source045 zentao-data-service136/145/175 and providers/zentao49 preserve the fresh returned detail revision.','object79291Complete':detail['data']['complete'],'listedAttachments':len(detail['data']['attachments']),'attachmentReads':0,'originalReferenceSHA256':H(J(ref))},'T122':{'assistantLine':final[0][0],'finalAnswerBytes':len(text.encode()),'finalAnswerSHA256':H(text),'asksEnvironmentURL':askURL,'asksTestAccount':askAccount,'originalHTTPURLCandidates':http,'originalTestAccountLabelMentions':account,'browserCalls':0,'openedPage':False,'bodyOrAccountCopiedToReview':False},'failuresKept':[{'line':34,'scope':'local subcommand --help probe','exit':2,'code':'INVALID_INPUT','effectState':'not-started','Host':0},{'lines':[59,60],'scope':'body/history resource reads omitted required offset/length','exit':2,'code':'INVALID_INPUT','effectState':'not-started','attemptCount':0,'Host':0,'correctedOnlyAfterOriginalSchemaRead':True,'correctedLines':[92,93]}],'contractInterpretation':{'basis':['测试用例.md:185 T127 expected explicitly permits environment/account OR T122 question','测试用例.md:180 T122 requires stop/ask/no environment opened on absent address','需求.md:602-603 original reads then missing/ambiguous -> ask before open','需求.md:631-633 real ZenTao only readonly; missing environment is original fixture branch'],'recommendation':'Current R001 satisfies T127 allowed missing-information branch, subject to Root final audit. Opening an explicit environment is conditional on such an environment being present. No invented URL/account or additional environment run is required to count this branch; do not claim actual URL-open or full real Bug reproduction. User later deferring reproduction is not the reason for this interpretation.','ledgerChanged':False},'normalAndCleanup':{'appExit':r['appExit'],'signals':r['observedProcess']['signals'],'independentAllClear':c['allClear'],'counts':{k:len(c.get(k,[]))for k in ['processes','ports','unix','helpers']}},'scopeBoundary':'No source/root-cause diagnosis from isolated empty cwd. Host authentication handshake is not a ZenTao business write. This read-only audit did not connect to a host, read auth/keychain/DB or send a model turn; exact original raw/full Native remain private and unchanged.'}
put('review.safe.json',result)
put('report.md','''R001 真实 Codex 已完成原只读缺信息分支。11 组 outer 调用/输出、15 条真实 typed 命令全部可解释，12 次数字退出0、3 次退出2均保留；四条 M10 v2 成功回执分别为本人列表、79291详情、正文与历史，逐条唯一绑定实际 Host 和不可变 plan/run/task/project/package。原一次 --help 与两次缺 offset/length 的 resource INVALID_INPUT 都是本地未开始，未伪造为 Host 失败；修正后正文676字节、历史1257字节，均 offset0、EOF true、nextOffset null。

完整 browser、bug-analysis、reproduce-bug Skill 及 scope.md 原字节输出已核；SOP另重复完整读取一次。首次并行outer有原始截断警告：Bug/scope/browser三份原结果完整可解析，首份SOP及工具目录尾部不完整，不能冒称首组四份全回模型；之后原27→28→30独立重复SOP完整回包后才调用业务。实际 Skill 文件清单摘要匹配本轮 plan.renderedHash；该字段是多文件清单摘要，不能拿它与单一SKILL.md字节摘要相等比较。原宿主 skillRead=unverified 保留，原因边界是原窄载体观察器未覆盖此次组合读取，而非实际未读。

本人列表完整3条，详情79291使用本次列表原reference，正文/历史使用详情原resource引用；附件仅元数据，0二进制读取、0浏览器调用、0禅道写入。完整fields/正文/历史内存检查未发现HTTP环境URL或测试账号标签；实际最终回复要求用户提供环境URL及测试账号，没有猜URL。

独立合同建议：T127原预期185行明确允许“能读出环境和账号或按T122询问”；T122原180行要求缺地址时停问且不打开环境，需求602–603行也将此作为打开前分支。因此当前事实可以满足原T127允许的完整缺信息路径，由Root最终复核归账；不宣称已经打开真实环境、登录或复现。这个结论来自原合同，不因用户暂缓后续复现而缩减范围。

App正常0/null/signals[]，独立10PID/7TCP/2Unix/0helper全清。初次自动审批拒绝和静态label误报/等值修正原件保留。正文/账号/认证值/完整Native/端点/DB不入本交付；无测试重跑或公共账变更。
''')
# Recoverable local audit code contains no actual Bug text. Original private
# files are SHA references only; explicit send approval/static error are safe.
inputs=[]
for rel in ['raw.json','runtime-001/complete-native.private.jsonl','runtime-001/native-evidence.private.json','cleanup.json','pin.json','READY.json','manifest.json','payload-review.json','scope.json','run.mjs','run.before-explicit-label-property.mjs','check-static.mjs','static-result.json','explicit-send-authorization.json','root-static-failure-001.json']:
 p=P/rel;inputs.append({'path':str(p),'bytes':p.stat().st_size,'sha256':H(p.read_bytes()),'copied':False})
for rel in ['explicit-send-authorization.json','root-static-failure-001.json']:(O/rel).write_bytes((P/rel).read_bytes())
for rel in ['docs/里程碑/M12_浏览器自动化/验收/测试用例.md','docs/里程碑/M12_浏览器自动化/需求.md']:
 p=Path('/Users/liubu/hx/4.uprxiao/SmartDD')/rel;inputs.append({'path':str(p),'sha256':H(p.read_bytes()),'copied':False})
source=Path('/private/tmp/willyou-m12-park-menu-source-045/source')
for rel in ['src/main/core/applications/run-plan.ts','src/main/core/applications/session-projector.ts','src/main/core/applications/agent-adapter-registry.ts','src/main/core/applications/codex-skill-read-evidence.ts','src/main/core/applications/zentao-data-service.ts','src/main/core/applications/providers/zentao.ts']:
 p=source/rel;inputs.append({'path':str(p),'sha256':H(p.read_bytes()),'copied':False})
put('original-inputs.json',{'files':inputs,'originalBytesPreserved':True,'privateNativeContentCopied':False})
put('source-scope.json',{'resource0':True,'NoAppNativeOSNetworkNodeAuthDBAccess':True,'readOnlyFiles':['Own frozen runtime Native/raw/Host','Own generated public Skills and declared source inventory','Current frozen App038 source045 relevant verifier functions','Original authority rows'],'originalRawSHA256':H((P/'raw.json').read_bytes()),'fullNativeSHA256':H((P/'runtime-001/complete-native.private.jsonl').read_bytes()),'sensitiveBodyAndAccountCopied':False})
(O/'audit.py').write_bytes(Path('/private/tmp/audit-T127-R001.py').read_bytes())
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':H(p.read_bytes())}for p in sorted(O.iterdir())if p.is_file()and p.name!='manifest.json']
for p in sorted((O/'history').rglob('*')):
 if p.is_file():files.append({'path':p.relative_to(O).as_posix(),'bytes':p.stat().st_size,'sha256':H(p.read_bytes())})
put('manifest.json',{'scope':'M12-T127-R001-independent-offline-original-contract-review','files':files,'originalRawChanged':False,'actualExecution':False,'publicLedgerChanged':False})
print(json.dumps({'root':str(O),'auditChecks':len(checks),'allPassed':not unknown,'failedChecks':unknown,'safeSHA256':H((O/'review.safe.json').read_bytes()),'manifestSHA256':H((O/'manifest.json').read_bytes()),'files':len(files)},ensure_ascii=False))
