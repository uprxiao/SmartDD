import json,datetime
from pathlib import Path
p=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/ci-watch/attempt002')
log=p/'watch-reconnect-001.log' if (p/'watch-reconnect-001.log').exists() else p/'watch.log'
s=log.read_text().split('Refreshing run status every')[-1].split('\nANNOTATIONS')[0]
(p/'latest-status.txt').write_text(s)
rows=[];job=None;first=False
for line in s.splitlines():
 if '(ID ' in line:
  rows.append(line);job=line;first=False
 elif job and line.startswith('  *') and not first:
  rows.append(line);first=True
 elif line.startswith('  X'):rows.append(line)
state='\n'.join(rows);prior=p/'last-fingerprint.txt';changed=not prior.exists() or prior.read_text()!=state
if changed:
 prior.write_text(state)
 with (p/'observed-transitions.jsonl').open('a') as f:f.write(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'state':state})+'\n')
print(state if changed else 'No job/step change in latest recorded snapshot.')
