from pathlib import Path
import datetime,json,os,subprocess
b=Path('/private/tmp');sources=[];bases=set();pids=set();volumes=[]
for name in ['willyou-dev119-native-r1.json','willyou-dev119-native-r2.json','willyou-dev119-native-final.json']:
 d=json.loads((b/name).read_text());e=d['environment'];sources.append(name);bases.add(e['base']);assert e['detached'];assert not os.path.ismount(e['volume']);volumes.append({'path':e['volume'],'detached':True})
for name in ['willyou-dev119-app-r1.log','willyou-dev119-app-final.log']:
 row=next(json.loads(line) for line in reversed((b/name).read_text().splitlines()) if line.startswith('{"status":'));d=json.loads((Path(row['artifacts'])/'result.json').read_text());sources.append(row['artifacts']);bases.add(d['scratch']);pids.add(d['pid']);e=d['environment'];assert e['detached'] and not os.path.ismount(e['volume']);volumes.append({'path':e['volume'],'detached':True})
probe=json.loads((b/'willyou-dev119-volume-probe.json').read_text());assert probe['detached'] and not os.path.ismount(Path(probe['scratch'])/'volume');volumes.append({'path':str(Path(probe['scratch'])/'volume'),'detached':True})
commands={int(line.strip().split(None,1)[0]):line.strip().split(None,1)[1] for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines() if len(line.strip().split(None,1))==2}
rows=[{'pid':pid,'closed':pid not in commands,'currentCommand':commands.get(pid)} for pid in sorted(pids)];left=[command for command in commands.values() if any(base+'/' in command for base in bases)]
assert all(row['closed'] for row in rows),rows;assert not left,left
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':sources,'rows':rows,'ownFixtureProcessesLeft':left,'volumes':volumes,'allClosed':True,'allVolumesDetached':True}
(b/'willyou-dev119-process-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'allClosed':True,'appPids':len(pids),'allVolumesDetached':True,'volumeChecks':len(volumes)}))
