"""Whitelist native recordings for review; do not copy homes/auth or MCP argv."""
from pathlib import Path
import json,gzip,hashlib,re,sys
base=Path(__file__).resolve().parent;target=base/'results';target.mkdir(exist_ok=True)
manifest=[]
params={'threadId','turnId','itemId','delta','item','turn','requestId','command','cwd','message','error'}
claude={'actor','driver','t','type','subtype','session_id','uuid','parent_tool_use_id','message','result','is_error','num_turns','user_message_uuid','event','model','claude_code_version','usage'}
def sha(b):return hashlib.sha256(b).hexdigest()
def clean(x):
 if isinstance(x,dict):return {k:clean(v) for k,v in x.items() if not re.match(r'(?i)^(authorization|api_key|apikey|auth_token|access_token|refresh_token|signature)$',k)}
 if isinstance(x,list):return [clean(v) for v in x]
 if isinstance(x,str):
  x=re.sub(r'/Users/[^/\s]+','/Users/review-user',x)
  if re.search(r'(?i)(?:Bearer\s+[A-Za-z0-9_.-]{12,}|sk-[A-Za-z0-9_-]{16,})',x):raise ValueError('credential shape rejected')
 return x
for label,arg in zip(['writers','steer'],sys.argv[1:]):
 root=Path(arg).resolve()
 for name in ['result.json','host.jsonl','cleanup.json','versions.json']:
  f=root/name;raw=f.read_bytes();dest=target/(label+'-'+name)
  if name.endswith('.jsonl'):data=''.join(json.dumps(clean(json.loads(l)),ensure_ascii=False)+'\n' for l in raw.decode().splitlines())
  else:data=json.dumps(clean(json.loads(raw)),ensure_ascii=False,indent=2)+'\n'
  dest.write_text(data);manifest.append({'source':str(f),'sourceSha256':sha(raw),'file':dest.name,'sha256':sha(dest.read_bytes())})
 f=root/'native.jsonl';raw=f.read_bytes();events=[]
 for number,line in enumerate(raw.decode().splitlines(),1):
  e=json.loads(line)
  if e.get('driver')=='codex':
   out={k:e[k] for k in ['actor','driver','t','method','id'] if k in e};p=e.get('params',{});out['params']={k:v for k,v in p.items() if k in params}
   if 'thread' in p:out['params']['thread']={k:v for k,v in p['thread'].items() if k in ['id','status']}
   if 'turn' in out['params']:out['params']['turn']={k:v for k,v in out['params']['turn'].items() if k in ['id','status','error']}
  else:out={k:v for k,v in e.items() if k in claude}
  out['recordingLine']=number;events.append(clean(out))
 dest=target/(label+'-native.jsonl.gz');dest.write_bytes(gzip.compress((''.join(json.dumps(e,ensure_ascii=False)+'\n' for e in events)).encode(),mtime=0))
 manifest.append({'source':str(f),'sourceSha256':sha(raw),'file':dest.name,'sha256':sha(dest.read_bytes()),'events':len(events)})
(target/'recordings-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'files':len(manifest),'events':sum(m.get('events',0) for m in manifest)}))
