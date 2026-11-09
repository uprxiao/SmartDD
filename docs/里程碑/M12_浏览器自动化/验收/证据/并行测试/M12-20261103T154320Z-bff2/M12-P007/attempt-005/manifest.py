from pathlib import Path
import hashlib,json,datetime
r=Path('/private/tmp/willyou-m12-t065-executor-001/attempt-005');files=[]
for p in sorted(r.rglob('*')):
    if not p.is_file()or p.name=='manifest.json'and p.parent==r or p.relative_to(r).parts[0]in ['cache','__pycache__']:continue
    b=p.read_bytes();files.append({'path':str(p.relative_to(r)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
b=(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'group':'M12-P007','attempt':'attempt-005','scope':'Static full-source/hash reuse proof only; no native or build execution','files':files},ensure_ascii=False,indent=2)+'\n').encode();(r/'manifest.json').write_bytes(b)
for row in files:assert hashlib.sha256((r/row['path']).read_bytes()).hexdigest()==row['sha256'],row['path']
print(json.dumps({'files':len(files),'bytes':sum(x['bytes']for x in files),'manifestSha256':hashlib.sha256(b).hexdigest(),'allMatched':True}))
