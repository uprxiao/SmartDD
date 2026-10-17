from pathlib import Path
import hashlib,json
out=Path('/private/tmp/m9-predev-editor');out.mkdir(exist_ok=True)
def make(target):
 head=b'%PDF-1.7\n';objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',b'<< /Length 63 >>\nstream\nBT /F1 18 Tf 40 700 Td (WillYou large source byte guard) Tj ET\nendstream',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 prefix=head;offsets=[0]
 for i,obj in enumerate(objects,1):offsets.append(len(prefix));prefix+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
 def footer(padding):
  padhead=f'6 0 obj\n<< /Length {padding} >>\nstream\n'.encode();offset6=len(prefix);xrefpos=len(prefix)+len(padhead)+padding+len(b'\nendstream\nendobj\n');xref=b'xref\n0 7\n0000000000 65535 f \n'+b''.join(f'{v:010} 00000 n \n'.encode() for v in offsets[1:]+[offset6])+f'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n{xrefpos}\n%%EOF\n'.encode();return padhead,xref
 padding=target-1000
 for _ in range(5):padhead,xref=footer(padding);padding=target-len(prefix)-len(padhead)-len(b'\nendstream\nendobj\n')-len(xref)
 padhead,xref=footer(padding);file=out/f'pdf-large-{target}.pdf'
 with file.open('wb')as f:
  f.write(prefix);f.write(padhead);chunk=b'0'*1048576
  for _ in range(padding//len(chunk)):f.write(chunk)
  f.write(chunk[:padding%len(chunk)]);f.write(b'\nendstream\nendobj\n');f.write(xref)
 h=hashlib.sha256()
 with file.open('rb')as f:
  while chunk:=f.read(1048576):h.update(chunk)
 assert file.stat().st_size==target
 return {'file':file.name,'bytes':target,'sha256':h.hexdigest(),'pages':1,'shape':'valid PDF with unreferenced padding stream; byte/range guard sample, not complex decoded page or image stress'}
files=[make(n)for n in [16777216,134217728,268435456,268435457]]
Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-pdf-large-manifest.json').write_text(json.dumps({'files':files},indent=2)+'\n')
