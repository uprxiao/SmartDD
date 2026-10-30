from pathlib import Path
import json,time,sys,hashlib,subprocess,datetime
base=Path('/private/var/folders/rt/7q3bp7tx7p13zgcpkcfs04080000gn/T/willyou-m9-ui-4nPmew'); name,expected,external,mode,out=sys.argv[1:];target=base/'project'/name;want=hashlib.sha256(expected.encode()).hexdigest(); deadline=time.monotonic()+55
while time.monotonic()<deadline:
 for p in (base/'userdata/file-recovery/v1').glob('*/*/journal.json'):
  try:d=json.loads(p.read_text())
  except (ValueError,OSError):continue
  if d.get('kind')=='checkpoint' and d.get('relativePath')==name and d.get('draftHash')==want and d.get('state')!='resolved':
   before=target.read_text();at=datetime.datetime.now().astimezone().isoformat()
   if mode=='cli':subprocess.run(['/usr/bin/python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text(sys.argv[2])',str(target),external],check=True)
   else:target.write_text(external)
   evidence={'at':at,'target':str(target),'trigger':'actual durable checkpoint with expected local bytes','checkpoint':str(p),'localDraft':(p.parent/d['draftLeaf']).read_text(),'before':before,'external':external,'writer':mode,'after':target.read_text()};Path(out).write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n');print(json.dumps(evidence,ensure_ascii=False));sys.exit(0)
 time.sleep(.03)
raise SystemExit('Timed out without expected actual checkpoint; no external write performed')
