"""J11 own complex OOXML and exact CSV/TSV byte oracles; stdlib only."""
from pathlib import Path
import base64,csv,hashlib,io,json,re,struct,sys,tempfile,zipfile,zlib
sha=lambda b:hashlib.sha256(b).hexdigest()
def inspect(path):
 p=Path(path);b=p.read_bytes();out={'path':str(p),'bytes':len(b),'sha256':sha(b)}
 if p.suffix=='.docx':
  with zipfile.ZipFile(p)as z:out.update(names=z.namelist(),parts={n:sha(z.read(n))for n in z.namelist()},xmlText={n:z.read(n).decode('utf8')for n in z.namelist()if n.endswith('.xml')})
 else:
  delimiter='\t'if p.suffix=='.tsv'else',';out['bom']=b.startswith(b'\xef\xbb\xbf');out['lineEndings']=[x.hex()for x in re.findall(b'\r\n|\r|\n',b)]
  try:text=b.decode('utf-8-sig');out['rows']=list(csv.reader(io.StringIO(text,newline=''),delimiter=delimiter,strict=True));out['utf8']=True
  except(UnicodeDecodeError,csv.Error):out['utf8']=False
 return out
if len(sys.argv)>1 and sys.argv[1]=='verify':print(json.dumps(inspect(sys.argv[2]),ensure_ascii=False));sys.exit()
base=Path(tempfile.mkdtemp(prefix='willyou-office-writeback-fixtures-',dir='/private/tmp'));root=base/'project';root.mkdir();rows=[['name','quoted','multiline','empty','formula'],['中文🙂','comma, plus\tTAB','line 1\r\nline 2','','=SUM(A1:A2)'],['0012345678901234567','say "Hello"','末行'],['empty','','','',"+literal_text"]];cases=[]
for delimiter,extension in[(',','csv'),('\t','tsv')]:
 source=''.join(delimiter.join('"'+v.replace('"','""')+'"'if any(c in v for c in ['"',',','\t','\r','\n'])else v for v in row)+['\r\n','\n','\r','\r\n'][i]for i,row in enumerate(rows))
 for bom in[False,True]:
  name=('bom'if bom else'matrix')+'.'+extension;data=(b'\xef\xbb\xbf'if bom else b'')+source.encode();p=root/name;p.write_bytes(data);expected=data.replace(b'Hello',b'World');cases.append({'name':name,'mode':'editable','base64':base64.b64encode(data).decode(),'expectedBase64':base64.b64encode(expected).decode(),'before':inspect(p),'expectedRows':[[v.replace('Hello','World')for v in row]for row in rows]})
 name='utf16.'+extension;data=b'\xff\xfe'+source.encode('utf-16le');(root/name).write_bytes(data);cases.append({'name':name,'mode':'unsupported-encoding','base64':base64.b64encode(data).decode(),'before':inspect(root/name)})
name='legacy.csv';data=b'name,value\r\ncaf\xe9,original\r\n';(root/name).write_bytes(data);cases.append({'name':name,'mode':'unsupported-encoding','base64':base64.b64encode(data).decode(),'before':inspect(root/name)})
def png():
 def chunk(n,b):return struct.pack('>I',len(b))+n+b+struct.pack('>I',zlib.crc32(n+b)&0xffffffff)
 raw=b''.join(b'\0'+bytes([25,150,110,255])*64 for _ in range(32));return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,32,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';PR='http://schemas.openxmlformats.org/package/2006/relationships';CT='http://schemas.openxmlformats.org/package/2006/content-types';decl='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
parts={'[Content_Types].xml':f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'+''.join(f'<Override PartName="/{p}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>'for p,kind in [('word/document.xml','document.main'),('word/styles.xml','styles'),('word/header1.xml','header'),('word/footer1.xml','footer'),('word/comments.xml','comments')])+'</Types>',
 '_rels/.rels':f'<Relationships xmlns="{PR}"><Relationship Id="r1" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':f'<Relationships xmlns="{PR}">'+''.join(f'<Relationship Id="{id}" Type="{R}/{kind}" Target="{target}"/>'for id,kind,target in [('style','styles','styles.xml'),('image','image','media/image1.png'),('header','header','header1.xml'),('footer','footer','footer1.xml'),('comment','comments','comments.xml')])+'</Relationships>',
 'word/styles.xml':f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Sans" w:eastAsia="Noto Sans CJK SC"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
 'word/header1.xml':f'<w:hdr xmlns:w="{W}"><w:p><w:r><w:t>J11 HEADER ORIGINAL</w:t></w:r></w:p></w:hdr>',
 'word/footer1.xml':f'<w:ftr xmlns:w="{W}"><w:p><w:r><w:t>J11 FOOTER ORIGINAL</w:t></w:r></w:p></w:ftr>',
 'word/comments.xml':f'<w:comments xmlns:w="{W}"><w:comment w:id="0" w:author="Synthetic Author" w:date="2026-10-20T00:00:00Z"><w:p><w:r><w:t>J11 COMMENT ORIGINAL</w:t></w:r></w:p></w:comment></w:comments>',
 'customXml/unknown.xml':'<unknown xmlns="urn:willyou:j11">UNKNOWN_PART_MUST_STAY</unknown>'}
drawing='<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1828800" cy="914400"/><wp:docPr id="1" name="J11 green fixture"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
parts['word/document.xml']=f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>J11 COMPLEX ORIGINAL 中文🙂</w:t></w:r></w:p><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>COMMENT ANCHOR</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p><w:p><w:ins w:id="1" w:author="Synthetic Author" w:date="2026-10-20T00:00:00Z"><w:r><w:t>INSERTED ORIGINAL</w:t></w:r></w:ins><w:del w:id="2" w:author="Synthetic Author" w:date="2026-10-20T00:00:00Z"><w:r><w:delText>DELETED ORIGINAL</w:delText></w:r></w:del></w:p><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>'+''.join('<w:tr>'+''.join(f'<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>{v}</w:t></w:r></w:p></w:tc>'for v in row)+'</w:tr>'for row in [['TABLE A1','TABLE B1'],['中文 TABLE A2','TABLE B2']])+'</w:tbl><w:p><w:r>'+drawing+'</w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>J11 SECOND PAGE ORIGINAL</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>'
p=root/'complex.docx'
with zipfile.ZipFile(p,'w',compression=zipfile.ZIP_DEFLATED)as z:
 for n,b in parts.items():z.writestr(zipfile.ZipInfo(n,date_time=(2026,10,20,0,0,0)),(decl+b).encode())
 z.writestr(zipfile.ZipInfo('word/media/image1.png',date_time=(2026,10,20,0,0,0)),png())
cases.append({'name':p.name,'mode':'docx-readonly','base64':base64.b64encode(p.read_bytes()).decode(),'before':inspect(p),'features':['2pages','table2x2','embeddedPNG','header/footer','comments/anchor','tracked insertion/deletion author/time','unknown XML']})
manifest={'at':'2026-10-20','base':str(base),'project':str(root),'cases':cases,'boundary':'Own synthetic generator only. CSV/TSV raw mixed EOL/quoted delimiters/UTF8 BOM/leading zeros/formula literals, targeted Hello->World exact byte oracle. UnsupportedUTF16/legacy distinct. Complex DOCX is genuine package with generated parts, not claiming layout equivalence or a write provider. Independent stdlib csv/ZIP reader for actual outputs.'};(base/'fixtures.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False))
