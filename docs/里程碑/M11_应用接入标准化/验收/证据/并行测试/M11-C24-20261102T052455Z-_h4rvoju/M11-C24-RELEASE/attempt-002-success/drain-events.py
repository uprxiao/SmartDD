import json
from pathlib import Path
P=Path('/private/tmp/willyou-m11-c24-v011-_h4rvoju/release-watch/attempt002');f=P/'observer.log';raw=f.read_text();lines=raw.splitlines();lines=lines if raw.endswith('\n') else lines[:-1];cursor=P/'drain-position.json';start=json.loads(cursor.read_text())['lines'] if cursor.exists() else 0;start=min(start,len(lines));events=[]
for line in lines[start:]:
 try:events.append(json.loads(line))
 except json.JSONDecodeError:pass
important=[x for x in events if x.get('stage')!='heartbeat']
for item in important or events[-1:]:print(json.dumps(item,ensure_ascii=False))
cursor.write_text(json.dumps({'lines':len(lines)})+'\n')
