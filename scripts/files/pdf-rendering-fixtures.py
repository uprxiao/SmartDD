"""Own synthetic PDF source for Y14/Y17; standard-library writer, no external tools."""
from pathlib import Path
import tempfile,json,hashlib,shutil
repo=Path(__file__).resolve().parents[2];base=Path(tempfile.mkdtemp(prefix='willyou-pdf-rendering-',dir='/private/tmp'));project=base/'project';project.mkdir();public=repo/'prototypes/m6-codex/public/assets/m9-pdf'
def make(width,height,marker):
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];pages=[]
 for i in range(5):
  w,h=(width,height) if i==0 else (595,842)
  text=f'{marker}_{i+1}';stream=f'0.85 0.95 0.94 rg 0 0 {w} {h} re f\n0 0 0 RG 4 w 1 1 {w-2} {h-2} re S\n0.1 0.2 0.3 rg BT /F1 {min(w/10,200)} Tf {w/10} {h*.8} Td ({text}) Tj ET'.encode();pn=len(objects)+1;cn=pn+1;pages.append(pn);objects += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /Font << /F1 3 0 R >> >> /Contents {cn} 0 R >>'.encode(),b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
 objects[1]=f'<< /Type /Pages /Count 5 /Kids [{" ".join(str(p)+" 0 R" for p in pages)}] >>'.encode();data=bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');offsets=[0]
 for i,body in enumerate(objects,1):offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+body+b'\nendobj\n'
 xref=len(data);data+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
 for offset in offsets[1:]:data+=f'{offset:010d} 00000 n \n'.encode()
 data+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode();return bytes(data)
rows=[]
for name,source,data in [('normal.pdf','normal',(public/'normal.pdf').read_bytes()),('scripts.pdf','dev136-scripts',(repo/'prototypes/m6-codex/tests/predev-editor/pdf-fixtures/javascript-link.pdf').read_bytes()),('square.pdf','dev136-square',make(14400,14400,'SQUARE')),('tall.pdf','dev136-tall',make(12,14400,'TALL'))]:
 (project/name).write_bytes(data)
 if source!='normal':
  p=public/(source+'.pdf');assert not p.exists() or p.read_bytes()==data;p.write_bytes(data)
 rows.append({'name':name,'prototypeSource':source,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
r={'projectPath':str(project),'cases':rows};(base/'fixtures.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
