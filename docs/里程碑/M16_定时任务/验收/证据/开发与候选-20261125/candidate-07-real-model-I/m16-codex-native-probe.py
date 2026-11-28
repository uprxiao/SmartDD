import os, subprocess, tempfile, pathlib, json, time, shutil, hashlib
from pathlib import Path
original=Path('/Users/liubu/.codex/auth.json');exe=Path('/Users/liubu/.local/bin/codex').resolve(strict=True)
if not original.is_file() or original.stat().st_uid!=os.getuid():raise SystemExit('authorized local login not available')
original_hash=hashlib.sha256(original.read_bytes()).digest()
with tempfile.TemporaryDirectory(prefix='m16-native-codex-',dir='/private/tmp') as root:
 home=Path(root,'home');home.mkdir(mode=0o700);cwd=Path(root,'project');cwd.mkdir(mode=0o700);conf=Path(home,'.codex');conf.mkdir(mode=0o700)
 auth=conf/'auth.json';shutil.copyfile(original,auth);auth.chmod(0o600)
 env={k:v for k,v in os.environ.items() if k in {'PATH','LANG','LC_ALL','TZ','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','https_proxy','http_proxy','no_proxy','ALL_PROXY','all_proxy'}}
 env.update({'HOME':str(home),'CODEX_HOME':str(conf),'ZDOTDIR':str(home),'TERM':'dumb'})
 def run(model,effort,prompt,session=None):
  common=['--json','--skip-git-repo-check','--ignore-user-config','-c','model_provider="openai"','-c','model_reasoning_effort="'+effort+'"','-c','web_search="disabled"','--disable','apps','-m',model]
  if session:args=[str(exe),'exec','resume',*common,session,prompt]
  else:args=[str(exe),'exec',*common,'--sandbox','read-only',prompt]
  start=time.monotonic()
  try:r=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=100)
  except subprocess.TimeoutExpired:return ({'requestedModel':model,'effort':effort,'outcome':'timeout'},None)
  events=[]
  for line in r.stdout.splitlines():
   try:events.append(json.loads(line))
   except ValueError:pass
  sid=next((e.get('thread_id') for e in events if e.get('type')=='thread.started'),None)
  reply='\n'.join(str(e.get('item',{}).get('text','')) for e in events if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='agent_message')
  receipt={'requestedModel':model,'effort':effort,'exitCode':r.returncode,'durationMs':round((time.monotonic()-start)*1000),'markerReturned':'M16-CODEX-5298' in reply,'hasSession':bool(sid),'resumedSameSession':bool(session and sid==session),'turnCompleted':any(e.get('type')=='turn.completed' for e in events),'onlySyntheticPrompt':True}
  if r.returncode!=0:
   msg=(r.stderr+' '+r.stdout).lower();receipt['failureClass']='auth' if ('401' in msg or 'unauthorized' in msg or 'authentication' in msg) else 'rate' if '429' in msg else 'network' if 'connection' in msg or 'network' in msg else 'configuration' if 'model' in msg or 'effort' in msg else 'other'
  return receipt,sid if r.returncode==0 else None
 first,sid=run('gpt-6.2-sol','medium','Only remember and return the synthetic test marker M16-CODEX-5298. Do not use tools, read files, or perform any other operation.')
 results=[first]
 if sid and first['markerReturned']:
  second,_=run('gpt-6.2-sol','high','Return the exact synthetic marker from the prior conversation. No tools.',sid);results.append(second)
 print(json.dumps({'channel':'user-authorized local Codex login, private copy of native auth','isolated':True,'originalFileUnchanged':hashlib.sha256(original.read_bytes()).digest()==original_hash,'results':results}))
