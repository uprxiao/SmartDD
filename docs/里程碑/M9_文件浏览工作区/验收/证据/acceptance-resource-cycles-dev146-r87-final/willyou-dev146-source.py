from pathlib import Path
import json,hashlib,tarfile,datetime
h=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();parent=Path('/private/tmp/willyou-dev145-source-delta.json');old=json.loads(parent.read_text());assert len(old['files'])==1283
for n,v in old['files'].items():assert h(n)==v,n
added={n:h(n)for n in ['scripts/files/resource-cycle-fixtures.py','scripts/files/resource-cycle-ui.mjs','src/main/core/files/resource-cycle-acceptance.test.ts']};files=old['files']|added;tar='/private/tmp/willyou-dev146-source-delta.tar.gz'
with tarfile.open(tar,'w:gz') as t:
 for n in added:t.add(n,arcname=n)
d={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'previousManifest':str(parent),'previousManifestSha256':h(parent),'fileCount':len(files),'files':files,'changedFiles':{},'addedFiles':added,'deltaPath':tar,'deltaSha256':h(tar),'productionInputsUnchanged':True,'prototypeInputsUnchanged':True};p=Path('/private/tmp/willyou-dev146-source-delta.json');p.write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'sourceInputs':len(files),'sha256':h(p),'deltaSha256':h(tar)}))
