from pathlib import Path
import tempfile,json,hashlib,shutil,datetime
base=Path(tempfile.mkdtemp(prefix='willyou-resource-cycles-',dir='/private/tmp'));root=base/'project';root.mkdir()
shutil.copyfile('build/icons/variants/WillYou-jade-teal.png',root/'sample.png')
shutil.copyfile('/private/tmp/willyou-media-limit-_uznhlfb/project/base.wav',root/'sample.wav') if Path('/private/tmp/willyou-media-limit-_uznhlfb/project/base.wav').exists() else shutil.copyfile('/private/tmp/willyou-media-limit-_uznhlfb/base.wav',root/'sample.wav')
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
stream=b'BT /F1 18 Tf 40 100 Td (DEV146 REAL PDF RESOURCE CYCLE) Tj ET';objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream')
data=b'%PDF-1.7\n';offsets=[0]
for i,o in enumerate(objects,1):offsets.append(len(data));data+=str(i).encode()+b' 0 obj\n'+o+b'\nendobj\n'
at=len(data);data+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets[1:])+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(at).encode()+b'\n%%EOF\n';(root/'sample.pdf').write_bytes(data)
budget=Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-pdf-notebook-production-budgets.json')
d={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'root':str(root),'rounds':100,'protocolKinds':['png','pdf','wav'],'additionalBinaryMediaRounds':100,'memoryBudget':str(budget),'memoryBudgetSha256':hashlib.sha256(budget.read_bytes()).hexdigest(),'baseline':'each same shape warmup;10s idle; close all viewers then2s and explicit renderer GC each measured round','samples':[{ 'name':p.name,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.iterdir())],'boundary':'K09 real finite100 cycles per image/PDF/media shape plus100binary media. Not the distinct2000page50round or Notebook50round qualification.'}
(base/'fixtures.json').write_text(json.dumps(d,indent=2)+'\n');Path('/private/tmp/willyou-dev146-fixture-path.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps(d))
