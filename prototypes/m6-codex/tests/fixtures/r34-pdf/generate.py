from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, NumberObject, TextStringObject, ArrayObject, DecodedStreamObject
import json, hashlib
root=Path(__file__).resolve().parents[3]
out=root/'public/assets/m9-pdf'
out.mkdir(parents=True,exist_ok=True)
# 2000 real PDF pages, distinct text labels, no user documents.
w=PdfWriter()
font=w._add_object(DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')}))
for i in range(2000):
 p=w.add_blank_page(width=595,height=842)
 p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
 stream=DecodedStreamObject();stream.set_data(f'BT /F1 18 Tf 50 760 Td (WillYou R3.4 page {i+1} of 2000) Tj ET'.encode())
 p[NameObject('/Contents')]=w._add_object(stream)
with (out/'r34-large.pdf').open('wb') as f:w.write(f)
# CJK Type0 CID font, deliberately no FontFile stream: real non-embedded fixture.
w=PdfWriter();p=w.add_blank_page(width=595,height=842)
info=DictionaryObject({NameObject('/Registry'):TextStringObject('Adobe'),NameObject('/Ordering'):TextStringObject('GB1'),NameObject('/Supplement'):NumberObject(4)})
fontdesc=DictionaryObject({NameObject('/Type'):NameObject('/FontDescriptor'),NameObject('/FontName'):NameObject('/STSong-Light'),NameObject('/Flags'):NumberObject(6),NameObject('/FontBBox'):ArrayObject([NumberObject(-25),NumberObject(-254),NumberObject(1000),NumberObject(880)]),NameObject('/ItalicAngle'):NumberObject(0),NameObject('/Ascent'):NumberObject(880),NameObject('/Descent'):NumberObject(-120),NameObject('/CapHeight'):NumberObject(880),NameObject('/StemV'):NumberObject(80)})
cid=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/CIDFontType0'),NameObject('/BaseFont'):NameObject('/STSong-Light'),NameObject('/CIDSystemInfo'):info,NameObject('/FontDescriptor'):w._add_object(fontdesc),NameObject('/DW'):NumberObject(1000)})
font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type0'),NameObject('/BaseFont'):NameObject('/STSong-Light'),NameObject('/Encoding'):NameObject('/UniGB-UCS2-H'),NameObject('/DescendantFonts'):ArrayObject([w._add_object(cid)])})
p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})})
stream=DecodedStreamObject();stream.set_data(b'BT /F1 22 Tf 50 760 Td <'+ '文件工作区 中文测试'.encode('utf-16be').hex().encode()+b'> Tj ET')
p[NameObject('/Contents')]=w._add_object(stream)
with (out/'r34-cjk.pdf').open('wb') as f:w.write(f)
manifest={name:{'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()} for name in ['r34-large.pdf','r34-cjk.pdf']}
manifest['cjk']={'font':'STSong-Light','encoding':'UniGB-UCS2-H','embedded':False,'expectedText':'文件工作区 中文测试','caveat':'Glyph shapes depend on system CJK fallback; no cross-platform fidelity claim.'}
(Path(__file__).parent/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
