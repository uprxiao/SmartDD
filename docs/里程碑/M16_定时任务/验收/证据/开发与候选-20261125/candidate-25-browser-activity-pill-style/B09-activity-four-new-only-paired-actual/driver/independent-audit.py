from pathlib import Path
import os,json,sqlite3,hashlib,sys,subprocess,re,math
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD')
root=Path('/private/tmp/willyou-m16-b09-c25-activity-four-new-only-vvCzMv')
rp=root/'B09-C25-activity-four-new-only-result.json'
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(rp)=='f1396315abbaf6f9bba2fb83c3ee63ad931bb0415890d5b2ca28fb4768c73d8d'
r=json.loads(rp.read_text()); audit={'sourceReportSha256':sha(rp),'sourceReport':str(rp),'scope':'Independent actual business, original visual, exact process/port and closed own database aggregate. No raw database/log/secret copies. No App or listener launched.','sides':[],'visual':{}}
assert len(r['captures'])==16 and len(r['pairs'])==16 and r['fixtureClosed']
assert len(r['model'])==16
allIDs=set(); pids=set(); ports={3425,61917}; seen=set()
for l,s in zip(r['launches'],r['sides']):
 side=s['side']; pids.add(l['pid']); ports.add(s['startupObservation']['cdpPort'])
 assert l['exit']=={'pid':l['pid'],'code':0,'signal':None}
 assert l['finalCounts']=={'secretCount':0,'providerSecretCount':0}
 assert s['actualEmptyInitialCounts']=={'secretCount':0,'taskCount':0,'providerCount':0,'browserV1':0} and s['isolated']['initialDataEmpty']
 assert s['fixtureClosed']
 assert s['isolated']['userData']==l['userData'] and s['isolated']['home']==l['home'] and s['isolated']['cliHome']==l['cliHome']
 for ob in s['startupObservation']['nativeReadiness']['observations']:pids.add(ob['rendererPid'])
 app=Path(l['bundle']); assert sha(app/'Contents/Resources/app.asar')==l['expected']==(r['oldPin'] if side=='old-clean' else r['pin'])
 db=Path(l['userData'])/'smartdd.db'; assert str(db).startswith('/private/tmp/willyou-m16-f36-b09-c25-activity-fresh-mock-') and db.is_file()
 assert not Path(str(db)+'-wal').exists()
 a={'side':side,'appAsarSha256':l['expected'],'pid':l['pid'],'normalExit':l['exit'],'WALAbsent':True,'closedOwnDatabaseChecks':[],'browserPackage':s['browserPackage'],'fixtureClosed':True,'fixtureRequestCounts':{}}
 c=sqlite3.connect(db.as_uri()+'?mode=ro&immutable=1',uri=True)
 a['zeroSecretCounts']={'secretCount':c.execute('select count(*) from app_secrets').fetchone()[0],'providerSecretCount':c.execute('select count(*) from ai_providers where secret_ref is not null').fetchone()[0]}; assert a['zeroSecretCounts']==l['finalCounts']
 assert c.execute('select count(*) from application_invocations').fetchone()[0]==8
 assert c.execute('select count(*) from browser_operations').fetchone()[0]==8
 for path in ['/orders','/gate','/favicon.ico']:a['fixtureRequestCounts'][path]=sum(x['path']==path for x in s['fixtureRequests']); assert a['fixtureRequestCounts'][path]==4
 assert len(s['fixtureRequests'])==12
 for b in s['combos']:
  t,p,pg=b['taskId'],b['projectId'],b['pageId']; cn=b['canonical']; assert all(x not in allIDs for x in (t,p,pg)); allIDs.update((t,p,pg)); assert b['actualFourStates'] and b['resumedBeforeSecondNativeCommand'] and b['windowAndDocumentRetained'] and b['closedOwnPage']
  run,turn=b['initialNativeAgent']['run']['runId'],b['initialNativeAgent']['lastTurn']; assert b['initialNativeAgent']['working']==[{'turnId':turn,'status':'started'}]
  assert c.execute('select turn_id,run_id,status,source_kind from agent_turns where task_id=?',(t,)).fetchall()==[(turn,run,'completed','user')]
  invs=[];ops=[];cmds=[]
  for i,cmd in enumerate(b['commands']):
   rec=cmd['receipt']; op,req=rec['operationId'],rec['requestId']; success=i==1; state='succeeded' if success else 'failed';err=None if success else 'BROWSER_PAUSED'
   assert cmd['step']==i+1 and rec['code']==(0 if success else 2) and rec['errorCode']==err and cmd['polls']==0
   assert cmd['argv']==['browser','wait','--text','T145_GATE_READY_'+cn,'--timeout','20000','--page',pg]
   assert op not in seen and req not in seen; seen.update((op,req))
   if success: assert rec['resultSchema']=='willyou-app-result-v2' and rec['operation']=={'id':op,'requestId':req,'effectState':'read-only','origin':'cli'} and rec['source']['packageHash']==s['browserPackage']['hash']
   invs.append((op,run,req,p,t,'browser',s['browserPackage']['hash'],'browser.nav.wait','read',state,err,'read-only'))
   ops.append((run,'audit:'+req,t,pg,'wait',state,'read-only',err)); cmds.append({'step':i+1,'operationId':op,'requestId':req,'state':state,'errorCode':err,'code':rec['code']})
  assert set(c.execute('select operation_id,run_id,request_id,project_id,task_id,app_id,package_hash,tool_name,semantics,state,error_code,effect_state from application_invocations where task_id=?',(t,)).fetchall())==set(invs)
  assert set(c.execute('select run_id,request_id,task_id,page_id,command,state,effect_state,error_code from browser_operations where task_id=?',(t,)).fetchall())==set(ops)
  captures=[x for x in r['captures'] if x['side']==side and x['taskId']==t]; assert len(captures)==4
  cs={x['state']:x for x in captures}; assert set(cs)=={'B09-agent-active','B10-paused','B10-resumed','B09-agent-hold'}
  rel=next(q for q in s['fixtureRequests'] if q['path']=='/gate' and q['combo']==cn); assert rel['closedAt'] and rel['releasedAt']==b['gateRelease']['releasedAt']
  hold=None
  for state,x in cs.items():
   assert x['actualStatePassed'] and x['projectId']==p and x['pageId']==pg and x['key']==cn+'|'+state
   assert x['agent']['selectedTask']==t and x['browserSnapshot']['taskId']==t and x['browserSnapshot']['projectId']==p and x['browserSnapshot']['activeId']==pg and len(x['browserSnapshot']['tabs'])==1
   tab=x['browserSnapshot']['tabs'][0]; assert tab['id']==pg and tab['agentActive'] and x['browserSnapshot']['auth'] is None
   na=x['nativeAgent']; assert na==b['initialNativeAgent'] and na['run']['busy'] and na['lastTurn']==turn
   doc=x['document']; pids.add(doc['pid']); assert all(doc[k]==b['before'][k] for k in ['wc','pid','url','title']) and doc['doc']['timeOrigin']==b['before']['doc']['timeOrigin']
   assert doc['url']=='http://127.0.0.1:61917/orders?combo='+cn and tab['url']==doc['url']
   n=x['native'];g=n['g']; assert len(n['roots'])==(2 if side=='old-clean' else 1) and g['inner']==[1440,900] and g['dpr']==2 and g['theme']==b['theme'] and g['panel']['width']==b['width'] and g['separator']['value']==b['width']
   vr=g['viewport']; assert n['child']['bounds']=={'x':vr['x']+2,'y':vr['y']+2,'width':vr['width']-4,'height':vr['height']-4}==n['expected'] and n['child']['id']==doc['wc'] and n['child']['visible']
   assert n['win']['bounds']['width']==1440 and n['win']['bounds']['height']==900
   active,paused,resumed,holdState=(state==st for st in ['B09-agent-active','B10-paused','B10-resumed','B09-agent-hold'])
   assert x['browserSnapshot']['paused']==paused and tab['agentRunning']==active
   a1=x['agent']; assert a1['pauseButton']==(not paused) and a1['resumeButton']==paused and bool(a1['glow'])==(not paused) and a1['dot']['label']==('Agent 已暂停' if paused else 'Agent 活动')
   assert x['commandStep']==(2 if holdState else 1) and x['commandHadResultAtCapture']==(not active)
   assert x['terminalReceipt']==(None if active else b['commands'][1 if holdState else 0]['receipt'])
   assert doc['doc']['ready']==('T145_GATE_READY_'+cn if holdState else 'GATE_WAITING')
   if holdState:
    remaining=tab['agentHoldUntil']-x['terminalReceipt']['at']-x['elapsedAfterCLIResultMs']; assert math.ceil(remaining/1000)==20 and '20 秒后清除标记' in a1['agent']['text']; hold={'remainingMsAtCaptureFromReceipt':remaining,'displaySeconds':20,'captureAfterReceiptMs':x['elapsedAfterCLIResultMs']}
   f=Path(x['shell']['file']); assert f.parent==root and sha(f)==x['shell']['sha'] and f.stat().st_size==x['shell']['bytes']
  a['closedOwnDatabaseChecks'].append({'canonical':cn,'taskId':t,'projectId':p,'pageId':pg,'runId':run,'turnId':turn,'turnCompletedOnce':'user/completed','commands':cmds,'sameDocument':{k:b['before'][k] for k in ['wc','pid','url','title']},'sameTimeOrigin':b['before']['doc']['timeOrigin'],'sameNativeAgentTurnThroughout':True,'samePageRetained':True,'actualGeometryAndOverlayStates':4,'hold':hold,'literalGateOrder':'release after second native read wait begins','normalOwnPageClose':True})
 c.close(); audit['sides'].append(a)
# Only exact known run listener lines; do not retain log text.
for p in root.glob('*-electron.log'):
 for n in re.findall(r'Debugger listening on ws://127\.0\.0\.1:(\d+)/',p.read_text(errors='replace')):ports.add(int(n))
audit['cleanup']={'checkedAtUTC':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'pids':[],'ports':[],'fixtureClosedRecorded':True}
for p in sorted(pids):
 try: os.kill(p,0); result='PID present (could be later reuse; not killed)'
 except ProcessLookupError: result='ESRCH'
 except PermissionError: result='permission denied (not killed)'
 audit['cleanup']['pids'].append({'pid':p,'probe':result}); assert result=='ESRCH'
for p in sorted(ports):
 z=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:'+str(p),'-sTCP:LISTEN'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 audit['cleanup']['ports'].append({'port':p,'exit':z.returncode,'listenerRows':len(z.stdout.splitlines()),'stderrEmpty':not z.stderr}); assert z.returncode==1 and not z.stdout and not z.stderr
vf=json.loads((root/'derived-review/comparison-facts.json').read_text()); assert len(vf)==16
priorRoot=repo/'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125/candidate-24-browser-control-style-cascade/B09-activity-four-paired-actual-red';assert sha(priorRoot/'index.json')=='0a7a7fa62685f9205cb4fc1d2abdeef32cfe327db3df91ce18716054fe88f1a3';assert sha(priorRoot/'actual-result.json')=='64d702b729e0dc90e60b36ee610b8a0ca941d962d8055178ed4c481123bf27a4';assert sha(priorRoot/'independent-business-cleanup-audit.json')=='2a6217984afc72631899de294a500f571d5b27cea12f7bf729a2f2171d099881';old=json.loads((priorRoot/'actual-result.json').read_text());assert len(old['captures'])==32
pinKeys=['latestOriginalA','latestOriginalAMetadata','approvedP','approvedPMetadata','retainedOldActual','retainedC24ActualRed','C25Actual'];style_samples=0;svg_samples=0;hover_extra=[];hold_values=[];active=0;pausedCount=0;normalWidth=101.421875;actualPairs=[]
for v in vf:
 for k in pinKeys:
  f=repo/v[k]['path'];assert sha(f)==v[k]['sha256'] and f.stat().st_size==v[k]['bytes']
 assert v['C24NewPixelRegion']['rightOfPanel'] is None and v['oldNewPixelRegion']['rightOfPanel'] is None
 assert all(not diff for diff in v['C25VersusLatestOriginalRecordedStyleDiff'].values())
 key=v['key'];nc=next(x for x in r['captures']if x['key']==key);oldc=next(x for x in old['captures']if x['key']==key and x['side']=='old-clean');pair=next(x for x in r['pairs']if x['originalKey']==key);assert oldc['actualStatePassed'] and nc['actualStatePassed'] and pair['old']==oldc['shell']['sha']==v['retainedOldActual']['sha256'] and pair['new']==nc['shell']['sha']==v['C25Actual']['sha256'];assert oldc['native']['g']['inner']==nc['native']['g']['inner']==[1440,900] and oldc['native']['g']['panel']['width']==nc['native']['g']['panel']['width'] and pair['oldNativeRoots']==2 and pair['newNativeRoots']==1
 assert nc['originalVisualPredicate']['passed'] and nc['pillStyle']['passed'] and not nc['pillStyle']['errors'];theme=nc['metadata']['theme'];pa=nc['state']=='B10-paused';active+=not pa;pausedCount+=pa
 st=nc['pillStyle'];originalTarget=st['baseExpected'];hoverTarget=st['hoverExpected'];assert st['first']['hovered']==st['restored']['hovered'];
 if nc['state']=='B09-agent-hold':
  assert st['normal']['hovered'] is False and st['restored']['hovered'] is True;hover_extra.append(key);tab=nc['browserSnapshot']['tabs'][0];hold_values.append(tab['agentHoldUntil']-nc['terminalReceipt']['at']-nc['elapsedAfterCLIResultMs'])
 for typ,hovered in [('normal',False),('hover',True),('restored',st['first']['hovered'])]:
  obs=st[typ];t=hoverTarget if hovered else originalTarget;assert obs['hovered']==hovered;assert obs['style']==t['style'];assert obs['text']==('恢复 Agent' if pa else '暂停 Agent');assert obs['rect']['width']==normalWidth and obs['rect']['height']==32;assert obs['rect']['x']==1288.578125 and obs['rect']['y']==54
  style=obs['style'];color='rgb(154, 98, 0)' if pa else ('rgb(241, 241, 241)' if theme=='dark'else'rgb(41, 41, 41)');border='rgb(227, 181, 90)' if pa else ('rgb(48, 48, 48)' if theme=='dark'else'rgb(233, 233, 233)');background=('rgb(48, 48, 48)' if theme=='dark' else 'rgb(235, 235, 235)') if hovered else 'rgba(0, 0, 0, 0)';assert style['fontSize']=='12px' and style['fontWeight']=='500' and style['lineHeight']=='18px' and style['padding']=='6px 10px' and style['gap']=='5px' and style['borderWidth']=='1px' and style['borderStyle']=='solid' and style['borderRadius']=='22px' and style['color']==color and style['borderColor']==border and style['backgroundColor']==background
  assert len(obs['icons'])==1;svg=obs['icons'][0];assert svg['classes']==['lucide','lucide-play'if pa else'lucide-pause'];assert svg['rect']['width']==svg['rect']['height']==13 and svg['rect']['y']-obs['rect']['y']==9.5 and svg['width']==svg['height']=='13' and svg['viewBox']=='0 0 24 24' and svg['strokeWidth']=='2' and svg['strokeLinecap']==svg['strokeLinejoin']=='round' and svg['fill']==svg['computedFill']=='none' and svg['stroke']=='currentColor' and svg['computedColor']==svg['computedStroke']==color
  assert svg['shape']==([{'tag':'path','attributes':{'d':'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'}}] if pa else [{'tag':'rect','attributes':{'x':'14','y':'3','width':'5','height':'18','rx':'1'}},{'tag':'rect','attributes':{'x':'5','y':'3','width':'5','height':'18','rx':'1'}}]);style_samples+=1;svg_samples+=1
 actualPairs.append({'key':key,'oldSha':pair['old'],'newSha':pair['new'],'styleSamples':3,'svgSamples':3,'browserOriginalRecordedStyleDifferences':0,'currentStylePassed':True,'holdScreenshotHoverDifferenceFromOriginal':key in hover_extra})
assert active==12 and pausedCount==4 and style_samples==svg_samples==48 and len(hover_extra)==4 and len(hold_values)==4
ptrs=[x for x in r['actions']if x.get('kind')=='UI-pointer-move-only'];assert len(ptrs)==36;assert all(x['selector'] in ['.bw-toolbar .bw-pause','.bw-toolbar .bw-resume'] for x in ptrs)
failedPath=Path('/private/tmp/willyou-m16-b09-c25-activity-four-new-only-ktDzGh/B09-C25-activity-four-new-only-result.json');assert sha(failedPath)=='cfb1aa9c94027f027ae760fd68c307fb8d65aa1a919f3a66e58b068af5535bf8';failed=json.loads(failedPath.read_text());assert len(failed['launches'])==len(failed['captures'])==0 and failed['fixtureClosed'];v2pre=Path('/private/tmp/willyou-m16-f36-qa/C25-B09.2-agent-activity-four-new-only-v2-preflight.json');assert sha(v2pre)=='e8ecb499706ab7a1178389c91d6e06b2bc9ffe6b94c9f0629f49ef8906daa528';pre=json.loads(v2pre.read_text());assert len(pre['guardChecks'])==10 and not pre['appLaunched'] and not pre['listenerStarted'];assert pre['exactPriorFailureReplay']['sha256']==sha(failedPath)
audit['visual']={'actualC25ShellPNG16AllShaVerified':True,'retainedOldActualPNG16AllShaVerified':True,'retainedC24RedPNG16AllShaVerified':True,'latestOriginalAP16All64HashesVerified':True,'actualCurrentBusinessStates':16,'actualOldBusinessStatesReused':16,'actualOriginalPairedKeys':16,'currentStrictOriginalHostStylePassKeys':16,'pauseStyleCaptures':active,'resumeStyleCaptures':pausedCount,'actualNormalHoverRestoreComputedStyleSamples':style_samples,'actualIconGeometryShapeAndPaintSamples':svg_samples,'normalHoverRestoreMouseMovedOnlyInputs':len(ptrs),'allOriginalRecordedAgentBannerDotGlowResumeStyleDictsExact':True,'currentHoldScreenshotHoverDifferenceFromOriginal':hover_extra,'holdActualRemainingMsFromReceipt':hold_values,'sourceCurrentHostBoundary':'16 current actual original UI/business states, original C24 old 16 paired only. Historical old/P shell/native compositing differ; C25 true hold screenshot preserves actual prior pointer hover, original A hold screenshot pointer away; both actual normal and hover computed style exact, not pixel claim. No duplicate old/unit/derived credit.','pairs':actualPairs}
audit['priorFixtureFailure']={'path':str(failedPath),'sha256':sha(failedPath),'zeroLaunchesAndCaptures':True,'closed':True,'correctedExactGuardReplaySha':sha(v2pre),'guardChecks':pre['guardChecks']}
out=root/'derived-review/independent-business-cleanup-style-audit.json';out.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n');print('audit',sha(out),'PIDs',pids,'ports',ports,'current business 16, original pairs 16, pill/svg48 each, hold',hold_values)
