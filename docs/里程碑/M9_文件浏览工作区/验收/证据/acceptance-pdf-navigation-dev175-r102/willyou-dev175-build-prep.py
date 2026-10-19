from pathlib import Path
import json,hashlib,tarfile
parent=json.load(open('/private/tmp/willyou-dev174-source-delta.json'))
changed=[n for n,v in parent['files'].items() if hashlib.sha256(Path(n).read_bytes()).hexdigest()!=v]
new=['scripts/files/pdf-navigation-ui.mjs','scripts/lib/pdf-navigation-matrix.mjs']
files={n:hashlib.sha256(Path(n).read_bytes()).hexdigest()for n in changed+new}
Path('/private/tmp/willyou-dev175-prebuild-source.json').write_text(json.dumps({'parent':'/private/tmp/willyou-dev174-source-delta.json','parentInputs':1389,'changed':changed,'new':new,'files':files},indent=2)+'\n')
with tarfile.open('/private/tmp/willyou-dev175-prebuild-source.tar.gz','w:gz')as t:
 for n in files:t.add(n,arcname=n)
Path('/private/tmp/willyou-dev175-cases-before.json').write_bytes(Path('docs/里程碑/M9_文件浏览工作区/验收/用例覆盖索引.json').read_bytes())
s=Path('/private/tmp/willyou-dev170-r99-fast-package.mjs').read_text().replace('dev170','dev175').replace('r99','r100')
Path('/private/tmp/willyou-dev175-r100-fast-package.mjs').write_text(s)
print('changed',changed,'new',new)
