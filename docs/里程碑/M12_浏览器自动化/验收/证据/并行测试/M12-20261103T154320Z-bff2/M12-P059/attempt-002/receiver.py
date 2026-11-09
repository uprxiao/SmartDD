#!/usr/bin/python3
import os,sys,re,json,time
from pathlib import Path
root=Path(os.environ['P059_ROOT']);runtime=root/'runtime-001';role=os.environ.get('P059_ROLE','unknown')
def event(value):
 value.update(role=role,atMs=time.time_ns()//1000000)
 with (runtime/'agent-events.jsonl').open('a')as f:f.write(json.dumps(value)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
event({'kind':'receiver-ready','pid':os.getpid(),'boundary':'Synthetichealth/requirements;actualTaskServicePTY;interactivewaitonly,noCLI'})
print('[A] P059 '+role+' synthetic wait-only receiver ready',flush=True)
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()});print('P059 ACK '+line.strip(),flush=True)
