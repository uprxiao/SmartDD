#!/usr/bin/python3
import sys,re,time
if '--version' in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print('{"appServerVersion":"0.166.0","configRequirements":{"requirements":null}}');sys.exit(0)
if 'exec' in sys.argv:
 m=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv));print(m.group() if m else '');sys.exit(0 if m else 70)
print('[A] T132 controlled idle task; no model, no CLI jobs',flush=True)
while True:time.sleep(1)
