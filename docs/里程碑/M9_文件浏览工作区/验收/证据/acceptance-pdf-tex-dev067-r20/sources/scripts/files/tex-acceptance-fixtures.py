"""Small original offline TeX fixtures for the actual packaged compile route."""
from pathlib import Path
import datetime,hashlib,json,tempfile
root=Path(tempfile.mkdtemp(prefix='willyou-tex-acceptance-',dir='/private/tmp'));project=root/'project';project.mkdir()
cases=[]
for name,kind,source in [
 ('success.tex','success',r'\documentclass{article}\begin{document}TEXF16SUCCESS $a^2+b^2=c^2$\end{document}'),
 ('missing-package.tex','failure',r'\documentclass{article}\usepackage{willyoumissingpackagef16}\begin{document}MUST_NOT_RENDER\end{document}'),
 ('no-pages.tex','no-output',r'\documentclass{article}\begin{document}\end{document}')]:
 data=(source+'\n').encode();(project/name).write_bytes(data);cases.append({'name':name,'kind':kind,'source':source+'\n','sha256':hashlib.sha256(data).hexdigest(),'size':len(data)})
oracle={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(project),'source':'Original minimal LaTeX, no shell commands, user files or network.','cases':cases}
(root/'fixtures.json').write_text(json.dumps(oracle,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'projectPath':str(project),'fixtures':len(cases),'manifest':str(root/'fixtures.json')}))
