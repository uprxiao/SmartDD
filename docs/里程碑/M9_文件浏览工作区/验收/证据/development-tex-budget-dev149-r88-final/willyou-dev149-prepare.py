from pathlib import Path
import tempfile,subprocess,json,hashlib,datetime
parent=Path('/private/tmp/willyou-pdf-limit-7d53hivq/project');base=Path(tempfile.mkdtemp(prefix='willyou-tex-budget-',dir='/private/tmp'));root=base/'project';root.mkdir()
for p in parent.iterdir():
 if p.is_file():subprocess.run(['/bin/cp','-c',str(p),str(root/p.name)],check=True)
(root/'parse-error.tex').write_text(r'\documentclass{article}\usepackage{willyoumissingbudgetcontrol}\begin{document}DEV149CONTROL\end{document}'+'\n')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  while x:=f.read(1048576):h.update(x)
 return h.hexdigest()
d={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(root),'parentFixture':str(parent),'cases':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(root.iterdir())],'boundary':'Own COW copied DEV148 deterministic fixtures plus explicitmissing-package control. Original DEV148 source/directory not changed.'};(base/'fixtures.json').write_text(json.dumps(d,indent=2)+'\n');Path('/private/tmp/willyou-dev149-fixtures.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'projectPath':str(root),'cases':len(d['cases'])}))
