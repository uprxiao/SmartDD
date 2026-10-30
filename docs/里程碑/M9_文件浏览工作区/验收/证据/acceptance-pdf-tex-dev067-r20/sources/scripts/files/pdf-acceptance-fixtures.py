"""Copy known synthetic PDFs and create a small non-embedded-font fixture."""
from pathlib import Path
import datetime,hashlib,json,shutil,tempfile
repo=Path(__file__).resolve().parents[2]
root=Path(tempfile.mkdtemp(prefix='willyou-pdf-formats-',dir='/private/tmp'));project=root/'project';project.mkdir()
sha=lambda data:hashlib.sha256(data).hexdigest()
sources=[
 ('normal.pdf','prototypes/m6-codex/public/assets/m9-pdf/normal.pdf','b778a3850cabaf01dfd8bb6e684781ccbb408d890b556c4f4e8506ea46a51f80','normal'),
 ('encrypted.pdf','prototypes/m6-codex/public/assets/m9-pdf/encrypted.pdf','c412661ad81258c5110672fe6d2f5be6ab780c22cf58aef95e1abb3e9daef73b','password'),
 ('garbage.pdf','prototypes/m6-codex/public/assets/m9-pdf/garbage.pdf','de7ef6753f04ce592af55b7c15e1f03cf28d454d4e82a3b7537a9b3d13eeeaac','invalid'),
 ('truncated.pdf','prototypes/m6-codex/public/assets/m9-pdf/truncated.pdf','9ffb22240a4a4f96e9850b632d5186c36723d473e5beca98a0c7245622ea8ee4','invalid'),
 ('invalid.pdf','prototypes/m6-codex/tests/predev-editor/pdf-fixtures/invalid.pdf','c6b7375f3b4a2cffb0025329ca4cd63f5f303fcd0fd32668a5b6ce2c62335d55','invalid'),
 ('cjk-missing-font.pdf','prototypes/m6-codex/public/assets/m9-pdf/r34-cjk.pdf','f207815b5822d29cf7bbfd1d2f3259c9e168f8514844090f33afe56e03eca920','cjk'),
 ('rotated.pdf','prototypes/m6-codex/tests/predev-editor/pdf-fixtures/rotated.pdf','ff2afde88842a2ac022a38b49e2a390706c78915e65505a613459e7e184c4568','rotated'),
 ('forms.pdf','prototypes/m6-codex/tests/predev-editor/pdf-fixtures/acroform.pdf','d7d27b05a1847382e5464caf24f93e6ef11772220d9ff4529d82151d972f7919','forms'),
 ('scripts.pdf','prototypes/m6-codex/tests/predev-editor/pdf-fixtures/javascript-link.pdf','ea2eaa95c2c64519c59e0585282ba7966aa3932499e5d9f98741daa578cc85e3','scripts')]
cases=[]
for name,relative,digest,kind in sources:
 data=(repo/relative).read_bytes();assert sha(data)==digest,relative
 (project/name).write_bytes(data);cases.append({'name':name,'kind':kind,'sha256':digest,'size':len(data),'syntheticSource':relative})
# Valid xref offsets; Type0 CJK uses packaged CMap, both faces omit FontFile.
# The second font deliberately has no installed/embedded face, exercising a
# genuine substitute-font path alongside CJK, differing sizes and vector art.
text='文件工作区 缺失字体混排验收'
stream=b'0.88 0.94 0.9 rg 35 670 525 125 re f\n0 0 0 rg\nBT /F1 22 Tf 50 760 Td <'+text.encode('utf-16be').hex().encode()+b'> Tj ET\nBT /F2 17 Tf 50 716 Td (WillYou MISSING_FONT Latin 12345) Tj ET\nBT /F1 13 Tf 50 685 Td <'+'不同字号与中文回退'.encode('utf-16be').hex().encode()+b'> Tj ET'
objects=[
 b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 7 0 R >> >> /Contents 8 0 R >>',
 b'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
 b'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>',
 b'<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
 b'<< /Type /Font /Subtype /Type1 /BaseFont /M9MissingSerif /Encoding /WinAnsiEncoding >>',
 b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
data=bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');offsets=[0]
for index,body in enumerate(objects,1):offsets.append(len(data));data+=f'{index} 0 obj\n'.encode()+body+b'\nendobj\n'
xref=len(data);data+=f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
for offset in offsets[1:]:data+=f'{offset:010d} 00000 n \n'.encode()
data+=f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
name='missing-mixed-fonts.pdf';(project/name).write_bytes(data)
cases.append({'name':name,'kind':'missing-mixed','sha256':sha(data),'size':len(data),'expectedText':text,'fonts':[{'name':'STSong-Light','embedded':False,'encoding':'UniGB-UCS2-H'},{'name':'M9MissingSerif','embedded':False,'encoding':'WinAnsiEncoding','faceDeliberatelyUnavailable':True}],'boundary':'Font substitution is measured on this Mac only; no signature/form editing or cross-platform glyph-equivalence claim.'})
oracle={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(project),'source':'Original known synthetic PDFs, plus this deterministic missing-font writer; no user document or network.','cases':cases}
(root/'fixtures.json').write_text(json.dumps(oracle,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'projectPath':str(project),'fixtures':len(cases),'manifest':str(root/'fixtures.json')}))
