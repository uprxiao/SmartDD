"""Y18 deterministic 200-page PDFs, no user files/dependencies/network."""
from pathlib import Path
import tempfile,json,hashlib
repo=Path(__file__).resolve().parents[2];base=Path(tempfile.mkdtemp(prefix='willyou-pdf-lifecycle-',dir='/private/tmp'));project=base/'project';project.mkdir()
def bulk(marker):
 objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];pages=[]
 for i in range(200):
  pn=len(objects)+1;cn=pn+1;pages.append(pn);stream=f'BT /F1 18 Tf 50 760 Td ({marker} page {i+1} of 200) Tj ET'.encode();objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {cn} 0 R >>'.encode(),b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream'])
 objects[1]=f'<< /Type /Pages /Count 200 /Kids [{" ".join(str(n)+" 0 R" for n in pages)}] >>'.encode();data=bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');offsets=[0]
 for i,v in enumerate(objects,1):offsets.append(len(data));data+=f'{i} 0 obj\n'.encode()+v+b'\nendobj\n'
 xref=len(data);data+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
 for offset in offsets[1:]:data+=f'{offset:010d} 00000 n \n'.encode()
 data+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode();return bytes(data)
rows=[]
for name,raw in [('bulk200.pdf',bulk('DEV137_BULK')),('alternate200.pdf',bulk('DEV137_ALTERNATE')),('normal.pdf',(repo/'prototypes/m6-codex/public/assets/m9-pdf/normal.pdf').read_bytes()),('encrypted.pdf',(repo/'prototypes/m6-codex/public/assets/m9-pdf/encrypted.pdf').read_bytes())]:
 (project/name).write_bytes(raw);rows.append({'name':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
r={'projectPath':str(project),'cases':rows};(base/'fixtures.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
