import json,hashlib,shutil,subprocess,os
from pathlib import Path
c=json.load(open('/private/tmp/willyou-m11-c7-current-round.json'));root=Path(c['root']);base=Path(c['packageApp']);targetRoot=Path('/private/tmp/willyou-m11-s7/t25-variant-c7-attempt-001');targetRoot.mkdir(exist_ok=False);app=targetRoot/'WillYou.app';subprocess.run(['/bin/cp','-cR',str(base),str(app)],check=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def tree(app):
 out={}
 for d,dirs,files in os.walk(app,followlinks=False):
  for name in list(dirs)+files:
   q=Path(d)/name;rel=str(q.relative_to(app))
   if q.is_symlink():out[rel]={'link':os.readlink(q)}
   elif q.is_file():out[rel]={'sha256':sha(q),'bytes':q.stat().st_size}
 return out
before=tree(base);assert tree(app)==before;old=app/'Contents/Resources/capability-bundles';assert old.is_dir() and not old.is_symlink();shutil.rmtree(old);shutil.copytree(root/'t25-variant-source/out/t25-capability-bundles',old)
subprocess.run(['/usr/bin/codesign','--force','--sign','-','--timestamp=none','--options','runtime','--identifier','com.smartdd.desktop','--entitlements',str(root/'source/build/entitlements.mac.plist'),str(app)],check=True)
subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(app)],check=True)
after=tree(app);assert tree(base)==before;changed={k:{'before':before.get(k),'after':after.get(k)} for k in sorted(before.keys()|after.keys()) if before.get(k)!=after.get(k)}
for k in changed:assert k.startswith('Contents/Resources/capability-bundles/') or k in ['Contents/MacOS/WillYou','Contents/_CodeSignature/CodeResources'],k
assert sha(app/'Contents/Resources/app.asar')==c['asarSha256'];r={'schema':'m11-t25-private-app-variant-v1','baseApp':str(base),'app':str(app),'baseAsarSha256':c['asarSha256'],'asarSha256':sha(app/'Contents/Resources/app.asar'),'baseFileCount':len(before),'variantFileCount':len(after),'baseUnchanged':True,'allowedDifferences':'sample-only application data bundles/index; outer signature/main executable signing seal only. Mail/Zen/adapters/runtime unchanged. No host source changes.','changed':changed,'nativeUnchanged':True,'release':False};(root/'t25-variant-generation/app-difference.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');(root/'t25-variant-generation/base-app-tree.json').write_text(json.dumps(before,indent=2)+'\n');(root/'t25-variant-generation/variant-app-tree.json').write_text(json.dumps(after,indent=2)+'\n');print(json.dumps({'app':str(app),'asar':r['asarSha256'],'baseFiles':len(before),'changed':len(changed),'nativeUnchanged':True}))
