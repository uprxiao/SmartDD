#!/usr/bin/python3
"""Own input-only raw receiver, with separate evidence for every restarted PTY."""
from pathlib import Path
import json,os,runpy,sys
if '--version' in sys.argv:
 print('WillYou isolated path failure receiver 1.0');sys.exit(0)
if not os.isatty(0):
 print('SMARTDD_OK: isolated path receiver requires interactive PTY');sys.exit(0)
base=Path(sys.argv[1]);session=base/'sessions'/str(os.getpid());session.mkdir(parents=True)
for name in ['state.json','raw.bin']:
 temporary=base/(name+'.link-pending');temporary.symlink_to(Path('sessions')/str(os.getpid())/name);os.replace(temporary,base/name)
(session/'identity.json').write_text(json.dumps({'pid':os.getpid(),'label':sys.argv[2],'session':str(session)}))
script=Path(__file__).with_name('context-receiver.py');sys.argv=[str(script),str(session),sys.argv[2]];runpy.run_path(str(script),run_name='__main__')
