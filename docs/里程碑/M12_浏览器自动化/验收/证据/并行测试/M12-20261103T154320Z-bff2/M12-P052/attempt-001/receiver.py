#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ.get('P052_ROOT','/private/tmp/willyou-m12-p052-s5-app-001'))
runtime=root/'runtime-001'
def event(value):
 value['atMs']=time.time_ns()//1000000
 with (runtime/'agent-events.jsonl').open('a') as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version' in sys.argv:
 print('codex-cli 0.166.0')
 sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:
 print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}))
 sys.exit(0)
if 'exec' in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group())
 sys.exit(0)
with (runtime/'terminal-pids.txt').open('a') as f:f.write(str(os.getpid())+'\n')
event({'kind':'receiver-ready','pid':os.getpid(),'synthetic':True,'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'cliPath':shutil.which('willyou-app'),'boundary':'Synthetic0.166version/requirementsprotocol, actualTaskServicePTY/M11/nativeCLI; notRealCodexRorOSsandbox'})
print('[A] P052 isolated synthetic Agent ready; enter RUN P052',flush=True)
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()})
 if line.strip()!='RUN P052':
  print('P052 ignored unexpected input',flush=True)
  continue
 config=json.loads((runtime/'commands.json').read_text())
 binary=shutil.which('willyou-app')
 if not binary:
  event({'kind':'fixture-error','message':'ManagedCLI missing from actual task PATH'})
  sys.exit(71)
 for index in range(1,4):
  expression='new Promise(resolve=>setTimeout(()=>resolve({fixture:"P052",step:'+str(index)+'}),3000))'
  args=['browser','eval','--expression',expression,'--page',config['pageId']]
  child=subprocess.Popen([binary]+args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  event({'kind':'cli-start','index':index,'pid':child.pid,'args':args})
  stdout,stderr=child.communicate(timeout=40)
  event({'kind':'cli-result','index':index,'pid':child.pid,'code':child.returncode,'stdout':stdout,'stderr':stderr})
  print('P052 CLI '+str(index)+' '+stdout.strip(),flush=True)
  if child.returncode!=0:
   event({'kind':'sequence-failed','index':index})
   sys.exit(child.returncode)
 event({'kind':'sequence-complete','count':3})
 print('P052 three commands complete; synthetic Agent exits normally',flush=True)
 sys.exit(0)
