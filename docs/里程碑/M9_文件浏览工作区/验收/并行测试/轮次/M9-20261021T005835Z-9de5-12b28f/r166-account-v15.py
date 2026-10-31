from pathlib import Path
import collections, datetime, hashlib, json

root=Path('/Users/liubu/Documents/ChatGPT/SmartDD');stage=root/'docs/里程碑/M9_文件浏览工作区';a=stage/'验收'
run='M9-20261021T005835Z-9de5-12b28f';rd=a/'并行测试/轮次'/run;ap=a/'用例覆盖索引.json'
raw=ap.read_bytes();d=json.loads(raw);cs={c['id']:c for c in d['cases']};h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
now=datetime.datetime.now(datetime.timezone.utc).isoformat();c=cs['M9-T-V15']
assert len(cs)==425 and c['status']=='未执行' and c['environments']==['R','P','I','A']
assert sum(x['status']=='通过' for x in cs.values() if x['scope']=='m9-local')==365
delivery=lambda g,n:a/'证据/并行测试'/run/g/('attempt-'+n)
expected={('M9-G135','003'):'5d809b431238dc40397796b71c105a6b08e8972b92b877cfbd82ec44a8ce0282',('M9-G138','001'):'d0a037042f083d3dec36201bba3a140d06323af963cd0b1d8a6139485a249528',('M9-G138','002'):'7551a10c50c45cbc12246665fae4d8ff3c57801eba216bae2f7f1719bd41e0ce',('M9-G138','003'):'428ba61e68475f98cfb7fc33ff6375ba886c3b3da4f2722bd9c31ebb7cc2d9a1',('M9-G138','004'):'648f3f7fca618b3a35efd5243a181fda593a292f1b314330f2d959e26f888307',('M9-G139','001'):'e8fa8c654a3a0e9fee63af8df0a0a4eb1e55b9ab62585838172974db4d926821'}
for (g,n),v in expected.items():assert h(delivery(g,n)/'manifest.json')==v
i=json.loads((delivery('M9-G138','001')/'result.json').read_text());assert i['counts']['numTotalTests']==i['counts']['numPassedTests']==19 and i['counts']['numFailedTests']==i['counts']['numPendingTests']==0
p=json.loads((delivery('M9-G138','004')/'result.json').read_text());pr=json.loads((delivery('M9-G138','004')/'raw/result.json').read_text())
assert p['plannedChecks']==p['passedChecks']==19 and p['failedChecks']==p['unexecutedChecks']==0
assert p['normal20Passed'] and p['explicitUserAuthorizedRetest'] and p['resourcesReleased'] and p['frozenInputsUnchanged']
assert len(pr['checks'])==19 and all(x['passed'] for x in pr['checks'])
assert pr['normalExit']['code']==0 and pr['normalExit']['signal'] is None and pr['businessCompleted'] and pr['originalPShellRestored']
assert pr['startupObserversRestored'] and pr['capabilitiesRestored'] and pr['ClipboardJournal']==[] and all(x['trusted'] for x in pr['controlJournal'])
assert pr['startupWindow']['activationCount']==0 and pr['startupWindow']['restored']
ar=json.loads((delivery('M9-G139','001')/'result.json').read_text());assert len(ar['checks'])==2 and all(x['pass'] for x in ar['checks']) and ar['normalExitObservedMs']==642
assert ar['normalExit']['code']==0 and ar['normalExit']['signal'] is None and ar['all23FrozenInputsUnchanged']
for proof in ['G138_P004_协调复核.json','G139_A001_协调复核.json']:
    assert json.loads((rd/proof).read_text())['allReleased']
ref=delivery('M9-G133','001')/'preparation/I-ready-r163P-v1/reference/reference-map.json'
for row in json.loads(ref.read_text())['primaries']:
    for key in ['raw','formatted']:
        v=row[key];f=Path(v['path']);assert f.stat().st_size==v['bytes'] and h(f)==v['sha256']
filename='m9-acceptance-v15-gallery-routing-complete-r166-20261023-9de5.json';ep=a/'证据'/filename;assert not ep.exists()
e={'schema':'m9-case-complete-review-v1','at':now,'caseId':c['id'],'currentScopeWholeCasePassed':True,'formalCaseIncrement':1,
   'originalContract':{k:c[k] for k in ['steps','expected','source','environments','requirements']},'approvedSourcePreconditions':c['source_preconditions'],
   'baseline':{'branch':'feature/0.0.1','head':'18efa6a6ae1722a0bcc8627ddd518f07d2f96625','sourceManifestSHA256':'254312ffe323ceffd12cf7897fc893fb5f1b1387880c83d6c3537993a6572f2c','sourceInputs':2390,'AppASARSHA256':'fb2a40907a63ac1b16baec01b261ea8e1f2d120daa78951c8fad0eb1a8298e69','nativeSHA256':'7afd006d8ae623f8b0da127d5acb46ab02350b2fe736e297633a24d28409f616','P334ManifestSHA256':'c98e51c01a2e2cd47658e1a297df30f88ca04a886651133351ab64c801116e8a'},
   'layers':{
       'R':str(ref.relative_to(a))+'; originalV1 Zel outer !G(Qp)&&local/chatgpt&&flag admits the open request; originalV27 inner !r(p)&&(explicitPortal??contextPortal)==null&&flag. Unknown imported environment predicates are explicit boolean adapter inputs, not guessed OS labels. G138 frozen independent literal19 and exact excerpts retain directtnl defaultDownload vs admitted V27 oldxel showDownload=false. Static archived reference admissibility retained; no targetApp modification/new live reference run claimed.',
       'I':'G138001 19/19 actual shared RoutedImageGallery/ImageGallery React consumer checks, real DOM portal owner, default/fallback Download controls, retained selected index. Only jsdom decoder/geometry ResizeObserver seams; no mocked routing decision helper. Original12+outer/inner env2+nullish priority2+admitted flagoff1+noRouting default1+realNextB/portalB1.',
       'P':'G138004 full shared FileWorkspace→tree Markdown→real image triggers and adapter checkbox/radio, actual native browser PNG decode and DOM portal identity. Original19/19, 35 adapter changes trusted and225 actual CDP input dispatches. Real NextB→portalB retainsB; admitted request flagoff retains oldfallback with noDownload; directly rejected old route stillDownload. Original19/10s controls25s CDP20s normal5s cleanup unchanged. This one cohort6.183s includes setup/normalclose; no general speed claim. Normal20code0null; aboutblank shell, memoryClipboard descriptor,6main/3DOM samehandler observers and3inspector sockets fully restored;root5PID1PGID3ports independentlyclear.',
       'A':'G139001 exact r166 packaged normal project App, real local Markdown twoPNG decode/next/previous/Close origin focus, current default old Gallery route. Originalnormal20 exit642ms0null;root10PID2ports clear;4source fullstat/hash unchanged. Newoverlay/flag/portal realApp host remains absent under approved precondition: condition untriggered, NOT new branch passed; no fake App producer/test switch. Default direct UI remains r165 behavior plus affected sanity.',
       'AffectedRegression':'G135003 root frozen2390/11deltas,118 related checks zero failed/pending,bothTypes0,uniform App6native smoke/617 package341runtime andP334 matched. Only external driver/ownedwindow preflight/identity changed for P002→004;source/App/P hashes constant, no rebuild.'},
   'outerAndInnerSemantics':'Outer admission captured once at open, later inner flag/env/portal chooses current rendering. Portal changes physically reparent actual Gallery while remembered navigation index preserves selected image. Explicit null falls through to context via??; explicit nonnull wins.',
   'oldRedsPreserved':{
       'P002':'0/19 business after tree3dispatch and first checkbox beforeinput hidden guard. NormalExit=null and cleanup0null distinct;source/prototype syntax history preserved.',
       'P003':'4/19 green then chatgpt radio selected, nativehide/trusted visibilitychange hidden while isVisible/isFocused initiallytrue, laterblur. Runtimeevaluate25s timeout around radio postclick twoRAF/checkedread; later plainbody/screenshot/cleanup evaluations succeeded. No requestID so no invented exact expression; no proof of persistent renderer hang or route effect loop. NormalExit=null/cleanup0null retained.',
       'P004':'Explicit user retest authorization “我不是很清楚，你重新测试吧” recorded; exact business/oracle/core/preflight/budgets reused in a new isolated identity. Startup already visible/focused,0activation and events[] throughout. Finalgreen proves this run; does not establish cause/fix for priorhidden events.'},
   'deliveries':[{'groupId':g,'attempt':n,'sha256':v} for (g,n),v in expected.items()],
   'notClaimed':['New actual App overlay/source/flag/portal producer','System Clipboard/download/Finder','Codex current live behavior or pixel equality','Native environment meaning for unknown G/r predicates','Old hidden-event root cause or production fix']}
ep.write_text(json.dumps(e,ensure_ascii=False,indent=2)+'\n');c['status']='通过';c['evidence'].append('证据/'+filename)
c['actual_result']+='\n2026-10-23 r166完整通过：原R outer准入/inner环境、flag及显式??context portal和两种旧容器下载差异已实hash核，实际状态化共享消费者I19全绿。用户明确授权重测后同源/同App/同P334的P004原19/19全绿，35控件change全trusted、225输入，真实PNG解码/NextB→portalB仍B/准入后flagoff回退禁下载/直接旧默认下载均齐；原10/25/20/5不改、normal20内0/null、root5PID1PGID3端口清。启动原已visible/focused故0激活/事件[]，不据本轮绿声称旧hidden已修；002零业务/003四绿与原超时normalnull、后续cleanup分开保留。同包现有本机默认旧路径真实A2正常642ms0/null及原件保护齐；新overlay真实host/flag/portal按获批前置未触发、不记该A分支通过、不造App开关。2390源/11增量/118相关回归/双类型/native6/617包341runtime齐；419/原步骤/预期/R-P-I-A层级保持。'
counts=collections.Counter(x['status'] for x in cs.values() if x['scope']=='m9-local');assert counts=={'通过':366,'未执行':48,'失败':4,'阻塞':1}
Path('/private/tmp/willyou-media-gallery-r166-root-9de5/authority-before-v15-complete.json').write_bytes(raw);ap.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
rp=rd/'轮次记录.json';r=json.loads(rp.read_text());r['updatedAt']=now;r['currentProgress'].update(at=now,asOf=now,passed=366,remaining=53,percentage=87.35,todayNewComplete=19,today20261023Complete=19,currentBatchNewComplete=1,statusCounts=dict(counts),status='V15wholeclosed afteruserauthorized P19clean;T23+V15thiscontinuation2complete;Officeconsumer gaps next;no release',sync='authorityupdated;originalgeneratorpending')
r['accountingReceipts'].append({'at':now,'id':'V15-complete-r166-20261023-9de5','caseIds':['M9-T-V15'],'formalCaseIncrement':1,'evidence':[{'path':'证据/'+filename,'sha256':h(ep)}],'generatorStatus':'pendingoriginal --write/--check'})
next(x for x in r['groups'] if x['groupId']=='M9-G138').update(state='V15wholeclosed;I19/P19/currentdefaultA2/R complete;all attempts archived/physicalreleased;oldhiddenunknown',resources=[])
r['batchMetrics'].append({'at':now,'batch':'r166T23-andV15','newCompleteUniqueCases':['M9-T-T23','M9-T-V15'],'formalCaseIncrement':2,'unifiedSuccessfulAppBuilds':1,'AppBuildElapsedSeconds':200.424,'codeChecksPassed':118,'fullP004CohortSeconds':6.183,'P004AdapterObservations':19,'P003WindowHiddenInterruptions':1,'rootAndWorkerUIConcurrentConflictsObserved':0,'scope':'NoApp20/memory replay;P004 userexplicitretest,oldred kept;time hereonly specific measured phases,not allwallclock throughrate'})
r['next']='Root serial Office legacyDOCX actualconsumer + workbooksource/manual/search gate implementation grouped;G142 localreuse handoff preparing;user/native/reference/platform remaining last'
rp.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':366,'remaining':53,'percentage':87.35,'today':19,'newComplete':['M9-T-V15'],'continuationComplete':['M9-T-T23','M9-T-V15'],'statusCounts':dict(counts)},ensure_ascii=False))
