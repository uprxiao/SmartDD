"""K04 real sparse PDFs and deterministic PNG/TeX output budget stress, own tmp only."""
from pathlib import Path
import tempfile,json,hashlib,random,struct,zlib
base=Path(tempfile.mkdtemp(prefix='willyou-pdf-limit-',dir='/private/tmp'));root=base/'project';root.mkdir()
def padded(path,total):
 stream=b'BT /F1 18 Tf 40 100 Td (DEV148_PDF_ABOVE_ARTIFACT_LIMIT) Tj ET';objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream'];data=b'%PDF-1.7\n';offsets=[0]
 for i,o in enumerate(objects,1):offsets.append(len(data));data+=str(i).encode()+b' 0 obj\n'+o+b'\nendobj\n'
 offsets.append(len(data));ending=b'\nendstream\nendobj\n';payload=total-1000
 for _ in range(10):
  head=b'6 0 obj\n<< /Length '+str(payload).encode()+b' >>\nstream\n';xref=len(data)+len(head)+payload+len(ending);tail=b'xref\n0 7\n0000000000 65535 f \n'+b''.join(f'{x:010d} 00000 n \n'.encode()for x in offsets[1:])+b'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n';new=total-len(data)-len(head)-len(ending)-len(tail)
  if new==payload:break
  payload=new
 with path.open('wb')as f:f.write(data+head);f.seek(payload,1);f.write(ending+tail)
 assert path.stat().st_size==total
for name,size in [('over40.pdf',40*1024*1024+1),('equal256.pdf',256*1024*1024),('above256.pdf',256*1024*1024+1)]:padded(root/name,size)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
rng=random.Random(148);compress=zlib.compressobj(6);encoded=[]
for _ in range(4096):encoded.append(compress.compress(b'\0'+rng.randbytes(4096*3)))
encoded.append(compress.flush());png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',4096,4096,8,2,0,0,0))+chunk(b'IDAT',b''.join(encoded))+chunk(b'IEND',b'');(root/'noise.png').write_bytes(png)
for name,source in [('small.tex',r'\documentclass{article}\begin{document}DEV148TEXNORMAL $a^2+b^2=c^2$\end{document}'),('large-output.tex',r'\documentclass{article}\usepackage{graphicx}\begin{document}DEV148TEXOUTPUTBUDGET\includegraphics[width=10cm]{noise.png}\end{document}')]: (root/name).write_text(source+'\n',encoding='utf8')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  while data:=f.read(1024*1024):h.update(data)
 return h.hexdigest()
d={'projectPath':str(root),'cases':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)}for p in sorted(root.iterdir())],'noise':{'width':4096,'height':4096,'channels':3,'seed':148,'generator':'Python random.Random.randbytes, zlib6, PNG RGB8'},'boundary':'Own real sparse PDFs with valid unreferenced padding stream; full logical FD byte size. Noise image has real high entropy pixels and drives genuine TeX PDF output limit. Not complex PDF layout or image display qualification.'};(base/'fixtures.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps(d))
