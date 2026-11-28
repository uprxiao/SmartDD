import os, subprocess, tempfile, pathlib, json, time
from pathlib import Path
secret=os.environ.get('DEEPSEEK_API_KEY')
if not secret: raise SystemExit('test credential unavailable')
exe=Path('/Users/liubu/.local/bin/claude').resolve(strict=True)
with tempfile.TemporaryDirectory(prefix='m16-real-deepseek-',dir='/private/tmp') as root:
 home=Path(root,'home');home.mkdir();cwd=Path(root,'project');cwd.mkdir(); conf=Path(home,'.claude');conf.mkdir()
 env={k:v for k,v in os.environ.items() if k in {'PATH','LANG','LC_ALL','TZ','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','https_proxy','http_proxy','no_proxy'}}
 env.update({'HOME':str(home),'CLAUDE_CONFIG_DIR':str(conf),'ANTHROPIC_BASE_URL':'https://api.deepseek.com/anthropic','ANTHROPIC_AUTH_TOKEN':secret,'ANTHROPIC_API_KEY':'','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1','DISABLE_TELEMETRY':'1','DISABLE_ERROR_REPORTING':'1','TERM':'dumb'})
 def run(model,effort,prompt,session=None):
  args=[str(exe),'-p','--output-format','json','--setting-sources','','--tools','','--model',model,'--effort',effort,'--permission-mode','default']
  if session:args+=['--resume',session]
  args+=[prompt]
  start=time.monotonic()
  try:r=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=90)
  except subprocess.TimeoutExpired:return ({'model':model,'effort':effort,'outcome':'timeout'},None)
  try:j=json.loads(r.stdout)
  except ValueError:j={}
  msg=str(j.get('result',''))
  receipt={'model':model,'effort':effort,'exitCode':r.returncode,'durationMs':round((time.monotonic()-start)*1000),'isError':bool(j.get('is_error',r.returncode!=0)),'subtype':j.get('subtype') if j.get('subtype') in ['success','error_during_execution','error_max_turns','error_max_budget_usd'] else None,'markerReturned':'M16-DEEPSEEK-9341' in msg,'hasSession':bool(j.get('session_id')),'resumedSameSession':bool(session and j.get('session_id')==session),'responseModelMatches':model in (j.get('modelUsage') or {})}
  if r.returncode!=0:
   combined=(r.stderr+' '+msg).lower()
   receipt['failureClass']='auth' if ('401' in combined or 'unauthorized' in combined or 'authentication' in combined) else 'rate' if '429' in combined else 'configuration' if 'model' in combined or 'effort' in combined else 'other'
  return receipt,j.get('session_id') if r.returncode==0 else None
 first,sid=run('deepseek-flash','medium','只需记住并原样回答以下合成测试标记，不执行其他操作：M16-DEEPSEEK-9341')
 results=[first]
 if sid and first['markerReturned']:
  second,_=run('deepseek-v4-pro','high','请只回答上轮约定的合成测试标记。',sid);results.append(second)
 print(json.dumps({'channel':'official DeepSeek Anthropic endpoint','isolated':True,'results':results},ensure_ascii=False))
