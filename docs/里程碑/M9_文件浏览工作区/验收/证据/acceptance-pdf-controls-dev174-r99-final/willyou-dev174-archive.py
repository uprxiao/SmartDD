from pathlib import Path
from urllib.parse import quote
import datetime,gzip,hashlib,json,platform,shutil
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';ev=base/'验收/证据';out=ev/'acceptance-pdf-controls-dev174-r99-final';out.mkdir(exist_ok=True);h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();audit=json.load(open('/private/tmp/willyou-dev174-result-audit.json'));source=json.load(open('/private/tmp/willyou-dev174-source-delta.json'));proc=json.load(open('/private/tmp/willyou-dev174-process-audit.json'));assert audit['status']=='passed'and all(x['allAbsent']for x in proc['rows']);assert all(h(n)==v for n,v in source['files'].items());art={}
def add(p,name=None):
 p=Path(p);b=p.read_bytes();name=name or p.name;compressed=len(b)>1024*1024 and p.suffix in['.json','.log'];q=out/(name+'.gz'if compressed else name);assert len(q.name.encode())<255
 if compressed:q.write_bytes(gzip.compress(b,mtime=0))
 else:shutil.copy2(p,q)
 art[q.name]={'path':str(q.relative_to(root)),'sha256':h(q),'bytes':q.stat().st_size,**({'compression':'gzip','originalSha256':h(p),'originalBytes':len(b)}if compressed else{})}
for row in proc['rows']:
 folder=Path(row['folder'])
 for p in sorted(folder.rglob('*')):
  if p.is_file()and not any(x=='userdata'or x.startswith('isolated-cli-')for x in p.relative_to(folder).parts):add(p,folder.name+'-'+quote(str(p.relative_to(folder)),safe=''))
for pattern in['willyou-dev174-*.json','willyou-dev174-*.log','willyou-dev174-*.mjs','willyou-dev174-*.cjs','willyou-dev174-*.py','willyou-dev174-*.tar.gz']:
 for p in sorted(Path('/private/tmp').glob(pattern)):
  if p.is_file()and p.stat().st_size and not p.name.endswith('archive-result.json'):add(p)
for p in Path('/private/tmp/willyou-dev174-before').iterdir():
 if p.is_file():add(p,'before-'+p.name)
fixtures=json.load(open('/private/tmp/willyou-dev174-native-fixtures.json'))
for n,digest in fixtures['files'].items():
 p=Path(fixtures['root'])/n;assert h(p)==digest;add(p,'native-source-'+n)
parent=ev/'m9-acceptance-path-formats-dev173-r99-20261020.json';assert h(parent)=='96ea044a901bc6bd026d176f3fb0d47da8d5d7b6bab32283858658addf116fb4';add(parent);add('/private/tmp/willyou-dev173-source-delta.json')
partial=ev/'m9-acceptance-pdf-controls-dev174-r99-partial-20261020.json';assert h(partial)=='530a107c88ed4998e33859cc1fac313aaf48fc5bf57639429722bafb8fdd3314';add(partial)
for n in['r99-native-smoke.log','prototype-build-final.log','sites-final.log','r99-fast-package-result.json']:add('/private/tmp/willyou-dev170-'+n)
reference=base/'调研/M9_文件类型与编辑状态全集.md';requirement=base/'需求.md';add(reference,'reference-file-types-R3.4.md');add(requirement,'requirements-R3.4-P1.md')
r={
 'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'localDate':'2026-10-20','caseIds':['M9-T-T03','M9-T-T04','M9-T-T05'],'status':'passed','revision':'R3.4-P1','branch':'feature/0.0.1','head':'89de9af4b631abdef5673ce8949fb02a32f6fcad',
 'environment':{'platform':'macOS','release':platform.mac_ver()[0],'arch':platform.machine(),'data':'Own knownsynthetic3pagePDF, private project/profiles. No model/PTY/nativepicker/clipboard/externalApp/daily resources or currentCodex access.'},
 'app':{'path':'/private/tmp/willyou-m9-acceptance-batch-r99-build/mac-arm64/WillYou.app','version':'0.0.5','asarSha256':audit['asarSha256'],'build':'Same original DEV170r99 fullbuild/afterPack/native sixsmoke, fresh81runtime. Production/P/native/dependency/build/version unchanged, no repack.'},
 'reference':{'path':str(reference.relative_to(root)),'sha256':h(reference),'scope':'Existing archived static D03/D04 source-index facts and reviewed R3.4 requirements: presets25/50/100/150/200, clamp30..800, fit cap100, ctrl-onlywheel/snap/anchor. Not new or dynamic Codex runtime verification.','requirementSha256':h(requirement)},
 'sourceSnapshot':{'inputs':1389,'manifest':'willyou-dev174-source-delta.json','delta':'willyou-dev174-source-delta.tar.gz','parentManifest':'willyou-dev173-source-delta.json','changedParentFiles':source['changedParentFiles'],'newFiles':source['newFiles'],'boundary':source['boundary']},
 'results':audit,
 'validation':{'componentAndRegressions':23,'newRealBufferComponent':3,'realNativeI':4,'prototypeComponentRegression':1,'uniqueVitestTests':28,'prototypeModels':12,'typecheck':'passed','appChecks':22,'prototypeChecks':22,'failures':0,'skipped':0,'prototypeBuild':'Same P inputs DEV170 final passed inherited','sitesTests':'Same original4passed inherited','nativeSmoke':'Same original6r99passed inherited','freshRuntimeHashes':81},
 'coverage':{'formalBefore':282,'formalAfter':285,'denominator':419,'percentage':round(285/419*100,2),'unexecuted':131,'blocked':3,'remainingIncludingApp':131,'total':425,'futureOnly':6,'newPassed':['M9-T-T03','M9-T-T04','M9-T-T05'],'otherCaseStatusesChanged':False},
 'caseEvidence':[
  'T03 R archived static behavior; A/P each light/dark5presets =10each:25really30 and no25check,50/100/150/200 correctlabel/menucheck. Actual body canvas width/height and textLayer scale match612x792point originalPDF; nonzero realcanvas/rendered/PAGE_ONE marker, budget cap16MP respected. No static fakecanvas as realA/P proof.',
  'T04 A/P each light/dark actual ownnative1000/1600content windows and resized/docked availablearea=6each. Original Electron setContentSize/getContentBounds only test window; no DOM geometry override. A currentavailable Fit55/80/dock72, P80/100/dock96, formula(available-48)/816 floor and clamp30..100. Sidebar right<=scrollleft, nooverlay. Fit explicitly selected at each current width, no invented sticky automaticmode.',
  'T05 A/P each light/dark ordinarywheel2retained events defaultunprevented/trusted and scrollwithoutzoom; Ctrl40up+60down=100eachtheme,200unique perlayer, alltrusted/defaultPrevented. End800/30, currentpage1 retained. Actual container verticalbase100 anchor100→100.125 at800 in all4runs; lowboundaryclamps0 and remains page1. No unregistered Cmd shortcut, touch or exact horizontalpixel anchor claim.',
  'Four original fileRPC inputs/results hash same(open2/refresh2), zero source save/checkpoint. Four originalresource inputs/results hash same(open2/release2), original56519bytes/hash matchesactualsource. UI fixed tab then original main workspaceSnapshot proves page1/zoom30 persisted in both themes; preview-only earlier runs not promoted as durable route.',
  'Seven originalhandler restore and readonlywheel observer removed, rendererErrors empty, A/P normal0/null. P real browser PDF.js overknownsyntheticasset created/destroyed4sessions active0; A native revision/protocol bytes distinct. Two final source copies fullSHA/inode/mtime individually unchanged; sevenknownownApps/processes absent, no unrecorded Workerprocess claim.',
  'New3 mounted productioncontrol tests use actualFileBuffer/preview/menu/wheel with decoder/canvas/jsdomgeometry isolated; plus20oldcomponent/model/wheel regressions=23. Native4originalSwift/chunk/actualPDF.js legacymetadata checks include newpresets/fitviewport consistency; Nodefakeworker notGUI. Pwheelcomponent1 and purePmodels12 pass.28uniqueVitest0skip/type pass.',
  'Production/P/native/dependencies/build/version unchanged, originalr99fullbuild/sixsmoke/Pbuild/Sites4 inherited sameinputs; fresh81runtime.1389source recovery parentDEV1731386+3newcomponent/matrix/driver and2oldguide/nativeItests. Earlier1387partial source/report retained, statuses neveradvanced frompartialalone.'
 ],
 'verificationHistory':[
  'Initial component queried firstthumbnail constantzoom100 instead ofbody; corrected test-only explicitthumbnail marker/bodyselector, originalproductunchanged;22pass1fail retained then23pass.',
  'Initial nativeI pages array needed explicittype in capturedfitclosure; originalTS7034/TS7005 retained, finaltype andnative4pass. Originalassets onlycopied, no sourceasset write.',
  'FirstA verified25→30 but CDP Escape did notclose menu; no focused key trace, so unknown focus/input/product cause. Keep originalfailure for T02, do notclaim keyboardpass or silentlyreclassify product. Finalcurrent cases use actualtrigger pointer toggle; T02 remainsunexecuted.',
  'Chrome Browser.getWindowForTarget unavailable in Electron endpoint; replace unsupportedtestAPI with originalownsingleBrowserWindow.setContentSize/contentbounds. Actual1000/1600 nativecontent widths checked. First5checkfailure retained.',
  'After firsttheme treehidden for PDF viewport, secondtheme must originalShowtree beforeopening. Firstlight11passed/darkopen timeout retained, restore UIprecondition then final22bothpassed.',
  'Unpinned A22/P22 initialsuccess independently retained. Final originalUI pin+live main persistedPDFhint verification added; finalA22/P22 rerun sequential on finaldriver. Actual imagesdarkA/P directly inspected. No productfixclaimed.'
 ],
 'inherited':{'report':str(parent.relative_to(root)),'sha256':h(parent),'passedBefore':282,'boundary':'All priorresults remain at originalscope; same r99build/smokes/sourcebaseline; partialDEV174 evidence retained immutably.'},
 'remaining':['T02 actual fulltoolbar/keyboardfocus including unresolvedEscape observation; T07hidden/inert andT08smoothnavigation remainoriginalscope','OtherPDF/image/media/system/human/referenceV/platform cases continue; T19raw0stillmissing and T32/T34/Y29threeblocked unchanged','M9incomplete, no case deletion/step changes or release'],
 'artifacts':art,'releasePerformed':False
}
p=ev/'m9-acceptance-pdf-controls-dev174-r99-20261020.json';p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'report':str(p.relative_to(root)),'sha256':h(p),'artifacts':len(art),'coverage':'285/419','percentage':round(285/419*100,2)}))
