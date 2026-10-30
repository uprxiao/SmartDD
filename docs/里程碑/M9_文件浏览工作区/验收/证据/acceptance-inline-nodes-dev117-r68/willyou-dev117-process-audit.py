from pathlib import Path
import datetime,json,os,signal,subprocess,time
base=Path('/private/tmp')
def commands():
    return {int(line.strip().split(None,1)[0]):line.strip().split(None,1)[1] for line in subprocess.check_output(['ps','-axo','pid=,command='],text=True).splitlines() if len(line.strip().split(None,1))==2}
before=commands(); stopped=[]
for pid,command in before.items():
    if command.startswith('node ../../node_modules/') and '/vite/' in command and '--port 5188 --strictPort' in command:
        os.kill(pid,signal.SIGINT);stopped.append({'pid':pid,'command':command,'signal':'SIGINT'})
for _ in range(40):
    current=commands()
    if all(row['pid'] not in current for row in stopped):break
    time.sleep(.05)
stop={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'stopped':stopped,'allClosed':all(row['pid'] not in current for row in stopped)}
assert stop['allClosed'];(base/'willyou-dev117-vite-stop.json').write_text(json.dumps(stop,indent=2)+'\n')
pids={row['pid'] for row in stopped};sources=[]
for log in sorted(base.glob('willyou-dev117-*.log')):
    rows=[json.loads(line) for line in log.read_text().splitlines() if line.startswith('{"status":')]
    if not rows:continue
    row=rows[-1];path=Path(row['artifacts'])/'result.json';value=json.loads(path.read_text());sources.append({'log':log.name,'result':str(path),'status':value['status']})
    if value.get('pid'):pids.add(value['pid'])
    if value.get('exit'):pids.add(value['exit']['pid'])
    for session in value.get('sessions',[]):
        if session.get('exit'):pids.add(session['exit']['pid'])
current=commands();rows=[{'pid':pid,'closed':pid not in current,'currentCommand':current.get(pid)} for pid in sorted(pids)]
left=[command for command in current.values() if command.startswith('/private/tmp/willyou-m9-acceptance-batch-r68-build/mac-arm64/WillYou.app/')]
assert all(row['closed'] for row in rows),rows
assert not left,left
value={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows,'sources':sources,'ownR68ProcessesLeft':left,'allClosed':True}
(base/'willyou-dev117-process-audit.json').write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps({'allClosed':True,'knownPids':len(pids),'viteStopped':stopped}))
