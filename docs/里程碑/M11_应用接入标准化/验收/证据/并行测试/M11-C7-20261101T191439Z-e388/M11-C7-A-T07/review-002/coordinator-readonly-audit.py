import json,hashlib,re,os,socket,sqlite3,errno,sys
from pathlib import Path
from datetime import datetime,timezone
p=Path(sys.argv[1]);assert str(p).startswith('/private/tmp/willyou-m11-s7-native-');d=json.load((p/'result.json').open());db=sqlite3.connect('file:'+str(p/'userdata/smartdd.db')+'?mode=ro',uri=True);rows=db.execute('SELECT pid,state,revocation_state FROM capability_runs').fetchall();db.close()
pids=[d['pid']]+[r[0] for r in rows if r[0]]
for pid in pids:
 try:os.kill(pid,0);raise AssertionError('Own PID still active '+str(pid))
 except ProcessLookupError:pass
assert all(r[1:]==('stopped','revoked') for r in rows),rows
ports=set(map(int,re.findall(r'(?:127\.0\.0\.1|localhost):(\d+)',(p/'electron.txt').read_text())))
for q in [p/'codex/config.toml',p/'codex/m11-native.config.toml']:
 if q.exists():ports.update(map(int,re.findall(r'127\.0\.0\.1:(\d+)',q.read_text())))
port_results=[]
for port in sorted(ports):
 s=socket.socket();s.settimeout(.3);code=s.connect_ex(('127.0.0.1',port));s.close();port_results.append({'port':port,'connectErrno':code});assert code==errno.ECONNREFUSED,(port,code)
tokens=set()
def visit(v):
 if isinstance(v,dict):
  if 'tokenSha256' in v:tokens.add(v['tokenSha256'])
  for x in v.values():visit(x)
 elif isinstance(v,list):
  for x in v:visit(x)
visit(d);assert tokens
old=p/'coordinator-cleanup-token-audit.json'
if old.exists():(p/'coordinator-cleanup-token-audit-sandbox-original.json').write_bytes(old.read_bytes())
files=[];hits=[];skipped=[];total=0
for q in sorted(p.rglob('*')):
 if q.is_symlink():skipped.append({'path':str(q.relative_to(p)),'kind':'symlink'});continue
 if q.is_file():
  b=q.read_bytes();total+=len(b);files.append(str(q.relative_to(p)))
  for candidate in set(re.findall(rb'(?<![a-f0-9])[a-f0-9]{64}(?![a-f0-9])',b)):
   if hashlib.sha256(candidate).hexdigest() in tokens:hits.append(str(q.relative_to(p)))
assert not hits,hits
proof={'status':'passed-readonly-cleanup-and-token-audit','at':datetime.now(timezone.utc).isoformat(),'pidsESRCH':pids,'portChecks':port_results,'portCheckContext':'authorized same-host execution; every port ECONNREFUSED, not sandbox EPERM','nativeRows':rows,'regularFiles':len(files),'bytes':total,'tokenIdentities':len(tokens),'rawTokenHits':hits,'skipped':skipped,'scope':'Every regular file, no size cutoff; hash each64hex candidate and compare original token digests; no raw bytes printed or persisted. Original sandbox connectivity audit retained as preliminary, superseded by this actual errno check.','hooks':{k:d.get(k) for k in ['gatewayFixtureRestored','captureFixtureRestored','cipherRestored']},'statusOfBusinessRun':d['status'],'failedStage':d.get('failedStage')};old.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');print(json.dumps(proof))
