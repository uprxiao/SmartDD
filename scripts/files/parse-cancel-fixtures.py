"""K10 large own Office packages and2000-page PDF, deterministic content, no network."""
from pathlib import Path
import tempfile,zipfile,json,hashlib
repo=Path(__file__).resolve().parents[2];base=Path(tempfile.mkdtemp(prefix='willyou-parse-cancel-',dir='/private/tmp'));root=base/'project';root.mkdir()
payload=b'<payload xmlns="urn:willyou:test">DEV147_LARGE_PART'+b'x'*(20*1024*1024)+b'</payload>'
seeds=repo/'docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final'
for ext in ['xlsx','pptx','docx']:
 parts={}
 if ext!='docx':
  with zipfile.ZipFile(seeds/('rich-source.'+ext))as z:parts={n:z.read(n)for n in z.namelist()}
 else:
  parts={'[Content_Types].xml':b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
   '_rels/.rels':b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
   'word/document.xml':b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DEV147_DOCX_LARGE_ORIGINAL</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'}
 parts['customXml/willyou-large.xml']=payload
 with zipfile.ZipFile(root/('large.'+ext),'w',compression=zipfile.ZIP_STORED)as z:
  for n,v in parts.items():z.writestr(zipfile.ZipInfo(n,date_time=(2026,10,19,0,0,0)),v)
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];pages=[]
for i in range(2000):
 pn=len(objects)+1;cn=pn+1;pages.append(pn);stream=f'BT /F1 18 Tf 50 760 Td (DEV147_LARGE_PDF page{i+1}) Tj ET'.encode();objects.extend([f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {cn} 0 R >>'.encode(),b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream'])
objects[1]=f'<< /Type /Pages /Count 2000 /Kids [{" ".join(str(n)+" 0 R"for n in pages)}] >>'.encode();data=b'%PDF-1.7\n';offsets=[0]
for i,v in enumerate(objects,1):offsets.append(len(data));data+=str(i).encode()+b' 0 obj\n'+v+b'\nendobj\n'
at=len(data);data+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()+b''.join(f'{n:010d} 00000 n \n'.encode()for n in offsets[1:])+f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{at}\n%%EOF\n'.encode();(root/'large.pdf').write_bytes(data)
(root/'target.txt').write_text('DEV147_TARGET_TEXT_UNCHANGED\n',encoding='utf8')
manifest={'projectPath':str(root),'cases':[{'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.iterdir())],'boundary':'Office20MiB real uncompressed safe unknown XML part plus authentic seed OOXML;2000real PDF pages. Stresses package IO/parse; no claim complex layout or actual CPU sampling.'};(base/'fixtures.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
