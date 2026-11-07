from pathlib import Path
import json,hashlib
R=Path(__file__).resolve().parent
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=R/'execution-ready.json';x=json.loads(p.read_text());s=R/'static-review.json';assert json.loads(s.read_text())['allStaticPassed'] is True
for f in x['inputs']:
 q=Path(f['path']) if f.get('external') else R/f['path'];assert h(q)==f['sha256'],str(q);assert q.stat().st_mode&511==f['mode']
x.update(requiredStaticSHA256=h(s),staticReady=True,readyForRootNativeLease=True)
p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
m=json.loads((R/'manifest.json').read_text());m['readySHA256']=h(p);m['staticResultSHA256']=h(s);(R/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'READY':h(p),'manifest':h(R/'manifest.json')}))
