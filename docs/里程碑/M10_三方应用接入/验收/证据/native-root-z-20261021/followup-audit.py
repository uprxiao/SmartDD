from pathlib import Path
import json,subprocess,datetime,hashlib
z=Path('/private/tmp/m10-native-root-z-20261021');root=Path('/private/tmp/willyou-m10-snapshots-x-8WvIfw');done=json.loads((root/'result-continuation-5.json').read_text());follow=json.loads((root/'result-continuation-6.json').read_text());assert done['status']=='passed-partial';assert follow['status']=='deferred-focus-loss';assert follow['ownAppCleanupComplete'];assert follow['nativeFocusAtYield']['windows'][0]['focused'] is False
app=Path('/private/tmp/m10-native-root-z-package-20261021/mac-arm64/WillYou.app');receipt=json.loads((z/'package-verification.json').read_text());assert hashlib.sha256((app/'Contents/Resources/app.asar').read_bytes()).hexdigest()==receipt['asarSha256']
raw=subprocess.check_output([str(app/'Contents/MacOS/WillYou'),'/private/tmp/m10-snapshot-cases-x-20261021/snapshot-fault-db.cjs',str(root/'userdata/smartdd.db'),'read',str(root/'case-manifest.json')],env={'PATH':'/usr/bin:/bin','ELECTRON_RUN_AS_NODE':'1'},timeout=10);(z/'followup-final-db.json').write_bytes(raw);db=json.loads(raw)
for c in db['cases']:
 seed=next(v for v in done['fault']['after'] if v['kind']==c['kind'])
 for key in ['task','refs','identity','runs']:assert c[key]==seed[key]
 for key in ['snapshot_json','snapshot_hash']:assert c['snapshot'][key]==seed['snapshot'][key]
 assert all(v['state']=='stopped' for v in c['runs']);assert all(v['state']=='exited' for v in c['children']);assert all(v['state']=='released' for v in c['leaseStates']);assert c['grants']==0 and c['invocations']==0
processes=[];pids={v['pid'] for v in json.loads((z/'completed5-process-audit.json').read_text())['processes']};pids.add(follow['pid'])
for pid in sorted(pids):
 p=subprocess.run(['ps','-p',str(pid),'-o','pid=,ppid=,etime=,command='],capture_output=True,text=True,timeout=5);assert p.returncode==1 and not p.stdout.strip();processes.append({'pid':pid,'exit':p.returncode,'output':p.stdout.strip()})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completed5PackageResult':'app/result-continuation-5.json:all5originalUIchecks passed','followup':'app/result-continuation-6.json:additional explicit button-settled wait;badJSONcomplete,unknown-schema restore settled butP09yielded;other3notattempted','followupStatus':'deferred-focus-loss;do not count remaining extra stability checks as passed','nativeFocusAtYield':follow['nativeFocusAtYield'],'all5OriginalRowsRetainedAndStoppedLeasesReleased':True,'knownOwnProcessesAbsent':len(processes),'processes':processes,'signalsSent':False,'M9Mutated':False,'packageHashUnchanged':receipt['asarSha256'],'goal':'active fullscope;T64notfull;2/72T42T63;T63primarynewpackagerecheckpassed;followupstabilityrestpending'}
(z/'followup-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'knownOwnProcessesAbsent':len(processes),'fiveOriginalRunsStopped':True,'followup':'deferred-focus-loss','newAsarUnchanged':True}))
