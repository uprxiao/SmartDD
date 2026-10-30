"""Read-only inherited structural oracle plus independent A1 font check."""
import contextlib,io,json,runpy,sys,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
stream=io.StringIO()
with contextlib.redirect_stdout(stream):runpy.run_path(str(Path(__file__).with_name('verify-office-ack.py')))
out=json.loads(stream.getvalue());ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(sys.argv[1])as z:
 cell=ET.fromstring(z.read('xl/worksheets/sheet1.xml')).find('.//s:c[@r="A1"]',ns);styles=ET.fromstring(z.read('xl/styles.xml'));xf=styles.find('s:cellXfs',ns)[int(cell.get('s','0'))];font=styles.find('s:fonts',ns)[int(xf.get('fontId','0'))];bold=font.find('s:b',ns);out['a1Bold']=bold is not None and bold.get('val','1')not in ['0','false']
print(json.dumps(out,ensure_ascii=False))
