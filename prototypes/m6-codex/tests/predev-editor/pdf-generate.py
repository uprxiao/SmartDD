from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, TextStringObject, ArrayObject, NumberObject, DecodedStreamObject, BooleanObject
import hashlib,json
out=Path(__file__).parent/'pdf-fixtures';out.mkdir(exist_ok=True)
def base():
 w=PdfWriter();p=w.add_blank_page(width=612,height=792)
 font=w._add_object(DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')}))
 p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
 stream=DecodedStreamObject();stream.set_data(b'BT /F1 24 Tf 50 700 Td (WillYou complex PDF fixture) Tj ET');p[NameObject('/Contents')]=w._add_object(stream)
 return w,p
w,p=base();p.rotate(90);w.write(out/'rotated.pdf')
w,p=base();w.encrypt('synthetic-pass',owner_password='synthetic-owner',algorithm='AES-256');w.write(out/'encrypted-aes256.pdf')
w,p=base();field=DictionaryObject({NameObject('/Type'):NameObject('/Annot'),NameObject('/Subtype'):NameObject('/Widget'),NameObject('/FT'):NameObject('/Tx'),NameObject('/T'):TextStringObject('syntheticName'),NameObject('/V'):TextStringObject('READONLY SAMPLE'),NameObject('/Rect'):ArrayObject([NumberObject(50),NumberObject(550),NumberObject(320),NumberObject(590)]),NameObject('/DA'):TextStringObject('/Helv 12 Tf 0 g'),NameObject('/F'):NumberObject(4)})
f=w._add_object(field);p[NameObject('/Annots')]=ArrayObject([f]);w._root_object[NameObject('/AcroForm')]=DictionaryObject({NameObject('/Fields'):ArrayObject([f]),NameObject('/NeedAppearances'):BooleanObject(True),NameObject('/DA'):TextStringObject('/Helv 12 Tf 0 g')});w.write(out/'acroform.pdf')
w,p=base();w.add_js("globalThis.PDF_EXECUTED=true; app.launchURL('https://invalid.example/predev-pdf-js');");link=DictionaryObject({NameObject('/Type'):NameObject('/Annot'),NameObject('/Subtype'):NameObject('/Link'),NameObject('/Rect'):ArrayObject([NumberObject(50),NumberObject(650),NumberObject(320),NumberObject(690)]),NameObject('/A'):DictionaryObject({NameObject('/S'):NameObject('/URI'),NameObject('/URI'):TextStringObject('https://invalid.example/predev-pdf-link')})});p[NameObject('/Annots')]=ArrayObject([w._add_object(link)]);w.write(out/'javascript-link.pdf')
w,p=base();p.mediabox.upper_right=(200000,200000);w.write(out/'oversized-page.pdf')
(out/'invalid.pdf').write_bytes(b'not a PDF; only a synthetic invalid file')
(out/'truncated.pdf').write_bytes((out/'rotated.pdf').read_bytes()[:100])
files=[{'path':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.glob('*.pdf'))]
(out/'manifest.json').write_text(json.dumps({'source':'synthetic pypdf 6.13.0 generator, no user files','files':files},indent=2)+'\n')
