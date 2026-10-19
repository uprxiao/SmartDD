from pathlib import Path
import datetime,json,subprocess
base=Path('/private/tmp')
logs=['willyou-dev116-prototype-ui-r1.log','willyou-dev116-prototype-ui-r2.log','willyou-dev116-prototype-ui-r3.log','willyou-dev116-prototype-ui-final.log','willyou-dev116-app-r1.log','willyou-dev116-events-regression-app.log','willyou-dev116-math-regression-app.log']
pids=set();sources=[]
for name in logs:
    row=next(json.loads(line)for line in reversed((base/name).read_text().splitlines())if line.startswith('{"status":'))
    path=Path(row['artifacts'])/'result.json';value=json.loads(path.read_text());sources.append({'log':name,'result':str(path),'status':value['status']})
    if value.get('pid'):pids.add(value['pid'])
    if value.get('exit'):pids.add(value['exit']['pid'])
    for session in value.get('sessions',[]):pids.add(session['exit']['pid'])
for row in json.loads((base/'willyou-dev116-vite-stop.json').read_text())['stopped']:pids.add(row['pid'])
commands={int(line.strip().split(None,1)[0]):line.strip().split(None,1)[1]for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines()if len(line.strip().split(None,1))==2}
rows=[{'pid':pid,'closed':pid not in commands,'currentCommand':commands.get(pid)}for pid in sorted(pids)]
left=[cmd for cmd in commands.values()if cmd.startswith('/private/tmp/willyou-m9-acceptance-batch-r67-build/mac-arm64/WillYou.app/')]
assert all(row['closed']for row in rows),rows
assert not left,left
value={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows,'sources':sources,'ownR67ProcessesLeft':left,'allClosed':True}
(base/'willyou-dev116-process-audit.json').write_text(json.dumps(value,indent=2)+'\n')
print({'allClosed':True,'knownPids':len(pids)})
