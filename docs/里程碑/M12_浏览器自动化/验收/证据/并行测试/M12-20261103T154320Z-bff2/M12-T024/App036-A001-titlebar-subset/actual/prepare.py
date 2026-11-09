from pathlib import Path
import json,hashlib
R=Path('/private/tmp/willyou-m12-t024-App036-A-prep-001');B=Path('/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-002');H=lambda b:hashlib.sha256(b).hexdigest()
for name in ['pin.json','activate-initial-exact-pid.applescript','initial-foreground-authorization.receipt.json','initial-focus.mjs','cleanup-owned-app.mjs','startup-error.mjs','resources.mjs','cleanup.mjs','io.mjs']:
 s=(B/name).read_text();s=s.replace(str(B),str(R));(R/name).write_text(s)
s=(B/'activate-initial-exact-pid.mjs').read_text().replace(str(B),str(R)).replace(str(R)+'/runtime-001/light/userdata',str(R)+'/runtime-001/userdata').replace(str(R)+'/runtime-001/dark/userdata',str(R)+'/runtime-001/userdata');(R/'activate-initial-exact-pid.mjs').write_text(s)
(R/'driver-source').symlink_to(B/'driver-source',target_is_directory=True);(R/'node_modules').symlink_to(B/'node_modules',target_is_directory=True)
(R/'contract.json').write_text(json.dumps({'case':'M12-T024','originalRequiredLayers':['A','S'],'scope':'A subset: real titlebar click from closed workspace twice, blank launcher and no native page; project view no task entry','pending':['T0 unassigned task real UI','Real system ShiftCommandB from terminal','PPTX Pages presentation editing selected element ShiftCommandB sends to back; not .pages','Project and T0 system shortcut no effect'],'wholeCasePassAllowed':False,'noSystemClipboard':True,'noRealModel':True},ensure_ascii=False,indent=2)+'\n')
print('Minimal reused lifecycle created')
