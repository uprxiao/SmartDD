from pathlib import Path
import os,json,sqlite3,hashlib,sys,subprocess,re,math
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD')
root=Path('/private/tmp/willyou-m16-b09-c24-activity-four-pair-XoBYIa')
rp=root/'B09-C24-activity-four-result.json'
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(rp)=='64d702b729e0dc90e60b36ee610b8a0ca941d962d8055178ed4c481123bf27a4'
r=json.loads(rp.read_text()); audit={'sourceReportSha256':sha(rp),'sourceReport':str(rp),'scope':'Independent actual business, original visual, exact process/port and closed own database aggregate. No raw database/log/secret copies. No App or listener launched.','sides':[],'visual':{}}
assert len(r['captures'])==32 and len(r['pairs'])==16 and r['fixtureClosed']
assert len(r['model'])==32
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
 db=Path(l['userData'])/'smartdd.db'; assert str(db).startswith('/private/tmp/willyou-m16-f36-b09-fresh-mock-') and db.is_file()
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
for v in vf:
 for k in ['latestOriginalA','latestOriginalAMetadata','approvedP','approvedPMetadata']:
  f=repo/v[k]['path'];assert sha(f)==v[k]['sha256'] and f.stat().st_size==v[k]['bytes']
 assert v['oldNewPixelRegion']['rightOfPanel'] is None
 assert all(not diff for k,diff in v['C24VersusLatestActualRecordedStyleDiff'].items() if k in ['agent','dot','glow'])
audit['visual']={'actualShellPNG32AllShaVerified':True,'latestOriginalAP16AllShaVerified':True,'actualBusinessStates':32,'actualPairs':16,'originalStrictVisualPassKeys':0,'pausedComputedRedCaptures':sum(not x['originalVisualPredicate']['passed'] for x in r['captures']),'otherVisiblePauseStyleRedCaptures':sum(x['state']!='B10-paused' for x in r['captures']),'reason':'Actual pause/resume browser pills lose exact original compact font12/weight500/pill radius22/border1. Resume color/border additionally lost amber. C24 true screenshots and original real A/P boards reviewed, all recorded other banner/dot/glow style exact. Full shell central user text/timing and M14 shell offset distinct. Native child is separate compositor; window+actual document proof only.'}
assert audit['visual']['pausedComputedRedCaptures']==8 and audit['visual']['otherVisiblePauseStyleRedCaptures']==24
out=root/'derived-review/independent-business-cleanup-audit.json';out.write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n');print('audit',sha(out),'PIDs',pids,'ports',ports,'sides',len(audit['sides']),'passed business 32, visual 0/16')
