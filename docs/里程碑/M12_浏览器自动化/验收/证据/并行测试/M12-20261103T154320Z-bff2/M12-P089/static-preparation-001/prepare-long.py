from pathlib import Path
import json,shutil,hashlib
root=Path('/private/tmp/willyou-m12-p089-coalition-long-001');assert not root.exists();root.mkdir(mode=0o700);payload=root/'payload';payload.mkdir(mode=0o700)
old=Path('/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004');p=json.loads((old/'prepared.json').read_text());pre=json.loads((old/'static-preflight.json').read_text());sd=json.loads((old/'sampler-dependencies.json').read_text());proof=json.loads((old/'coalition-proof-pin.json').read_text())
paths={x['path'] for x in pre['inputs']+p['sourceFiles']+p['privateDependencies']+sd['privatePsutilFiles']+proof['files']}
for n in paths:
 f=old/n;o=payload/n;o.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,o)
for n in ['run.mjs','prepare-pin.mjs','preflight.mjs']:
 f=payload/n;f.write_text(f.read_text().replace(str(old),str(payload)))
f=payload/'run.mjs';s=f.read_text();assert 'const SHORT_CPU_PREFLIGHT=false;' in s
needle="assert.equal(r.cpuLast.gaps.length,0,'Runtime CPU anchor/API gate beforeclock0');"
addition="""const expected=await poll(async()=>{try{return JSON.parse(await readFile(root+'/expected-cohort.json','utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}},10000);assert.equal(expected.driverPid,process.pid);assert.equal(expected.sourceManifestSha256,r.sourceManifest);assert.equal(expected.asarSha256,r.asarSha256);assert.deepEqual(r.coalitionInitialResourceIds,[expected.resourceId]);assert(!expected.externalResourceIds.includes(expected.resourceId));const roles={};for(const a of Object.values(r.cpuCollector.anchors))roles[a.role]=(roles[a.role]??0)+1;assert.deepEqual(roles,{app:1,electron:r.setupOsSample.electronMetrics.length-1,'fixed-daemon':5,receiver:5});r.cohortFence={...expected,actualAnchorRoles:roles,verifiedAtDriverMonoNs:String(nodeMono()),beforeClock0:true};await persist();"""
assert s.count(needle)==1;s=s.replace(needle,needle+addition);f.write_text(s)
short=Path('/private/tmp/willyou-m12-p088-coalition-wrapper-001')
for name in ['broker.m','wrapper.m','kernel.py','native_api.py']:
 s=(short/name).read_text().replace('p088-coalition-wrapper-','p089-coalition-long-')
 if name=='wrapper.m':assert '>300)' in s;s=s.replace('>300)','>2400)').replace('short300s-watchdog','full2400s-watchdog')
 (root/name).write_text(s)
s=(short/'run.mjs').read_text().replace("group:'M12-P088'","group:'M12-P089'").replace("scope:'short engineering membership only'","scope:'original full1800s CPU/RSS execution; no automatic formalcredit'").replace('.p088.','.p089.')
s=s.replace("stage='observe-original-short-payload'","stage='observe-original-full1800s-payload'").replace("},180000,'short original driver actual exit'","},2400000,'original full driver actual exit'")
s=s.replace("assert.equal(actual.status,'short-cpu-preflight-executed-unjudged');assert.equal(actual.commands.length,10);","assert.equal(actual.status,'executed-unjudged');assert.equal(actual.commands.length,40);")
s=s.replace("raw.status='executed-unjudged-short-only'","raw.status='executed-unjudged-original1800s'")
needle="raw.externalResourceIds=outside.map(x=>x.coalition.resourceId);"
addition="await writeFile(payload+'/expected-cohort.json',JSON.stringify({wrapperPid:appEvent.pid,driverPid:started.driverPid,resourceId:raw.wrapperResourceId,externalResourceIds:raw.externalResourceIds,sourceManifestSha256:JSON.parse(await readFile(payload+'/package-pin.json')).sourceManifestSha256,asarSha256:JSON.parse(await readFile(payload+'/package-pin.json')).asarSha256})+'\\n',{mode:0o600,flag:'wx'});"
assert s.count(needle)==1;s=s.replace(needle,needle+addition);(root/'run.mjs').write_text(s)
lineage={'scope':'Original full1800s T111 execution after actual independent-wrapper short gate','shortGate':str(short),'shortManifestSha256':'8d3f43ef1bae692262e9b8ca8d03373d554e5f92cfe02280fe4b58b259242368','actualShortGate':'10CLI/20anchors/7captures CID65248 vs host719; true App0-null; root44PID13TCP5Helper1Unix clear','sourceApp':'App019/source023 unchanged','payloadChanges':['Fresh root only plus required actualcohort fence beforeclock0','Original fullfalseSHORT flag, 35+5CLI/all7milestones/1800s/RSS110%/strictlast4/idle5%/originalsixscripts unchanged'],'outerChanges':['Unique private root/bundleID','300s short wrapper watchdog to2400s full budget','180s outer observation to2400s; expect40 originalCLI and originalfull status','Write actual wrapper/driver resourceCID+externalhost IDs; payload must validate20roles/nativecounter bindings beforeclock0'],'CPUProof':'Whole new resource coalition includes wrapper/driver/collectors as conservative superset; busyCPU kept in numerator, originalidle denominator; not App-exclusive. RetainedAnchor PID/birth/path/CIDs and original API/counter checks everycapture. Kernel ordinary spawn inheritance and selected controlledsnapshot closure supported by source references/actual007.','formalCaseCredit':0,'unknowns':'ActualfullCPU/RSS still unproven; oldT111 failure retained until originalfull result and independentreview. No crossclock comparisons or hiddenPID zeroing.'}
(root/'lineage.json').write_text(json.dumps(lineage,indent=2)+'\n');print('P089 fullsource created; no Native/App/model; original35+5 and strictcriteria retained')
