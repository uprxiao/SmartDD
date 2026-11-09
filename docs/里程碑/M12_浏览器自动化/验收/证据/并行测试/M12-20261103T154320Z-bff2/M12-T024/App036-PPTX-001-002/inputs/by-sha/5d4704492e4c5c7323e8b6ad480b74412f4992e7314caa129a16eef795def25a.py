from pathlib import Path
import re,json,hashlib,os
R=Path('/private/tmp/willyou-m12-t024-pptx-App036-001');seen={};H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def visit(p):
 p=Path(os.path.normpath(p));assert str(p).startswith(str(R)+'/')
 if str(p) in seen:return
 seen[str(p)]={'path':str(p),'sha256':H(p),'mode':p.stat().st_mode&511}
 if p.suffix=='.mjs':
  for s in re.findall(r'(?:from|import)\s*[\'\"]([^\'\"]+)[\'\"]',p.read_text()):
   if s.startswith('.'):visit(p.parent/s)
for p in [R/'run.mjs',R/'cleanup.mjs',R/'check-labels.mjs',R/'pin.json',R/'contract.json',R/'initial-foreground-authorization.receipt.json',R/'activate-initial-exact-pid.applescript']:visit(p)
pin=json.loads((R/'pin.json').read_text());seen[pin['sourceManifest']]={'path':pin['sourceManifest'],'sha256':H(Path(pin['sourceManifest'])),'mode':Path(pin['sourceManifest']).stat().st_mode&511}
d={'schema':'M12-T024-entry-A-subset-v1','coordinator':'root','scope':'Reuse current D23 successful App036 lifecycle only; synthetic idle CLI prep not realAgent; noGeneral/noSystemkeys/T0 or Pages','inputs':list(seen.values()),'driverGraph':list(seen),'AppRole':'App036-packaged','run':'run.mjs --execute'};(R/'ready.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print('frozen',len(seen),'inputs')
