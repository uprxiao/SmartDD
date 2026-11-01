import sys,json
t=sys.stdin.read()
try:
  d=json.loads(t); r=(d.get('probeReports') or [None])[0]
  print(d['tag'],'exit',d['codexExit'],'sec',d['seconds'],'brokerCalls',d['brokerCalls'],'leakfree',d['leakCheck'])
  if d['stderrTail'].strip(): print(' stderr:',d['stderrTail'][-250:].replace('\n',' | '))
  if r: print(' sandbox',r['codexHints'].get('CODEX_SANDBOX'),'| netdisabled',r['codexHints'].get('CODEX_SANDBOX_NETWORK_DISABLED'),'| env',list(r['env'].values())); print(' channel',r['channel']); print(' externalTcp443',r.get('externalTcp443'),'| proxyEnv',r.get('proxyEnvNames'))
  else: print(' no probe report')
except Exception as e: print(t[:900])
