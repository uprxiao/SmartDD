import struct,json,hashlib
from pathlib import Path
root=Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
headers=[Path('/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/mach-o')/p for p in ['nlist.h','stab.h','loader.h']]
assert '#define\tN_OSO\t0x66' in headers[1].read_text()
def parse(b):
 assert struct.unpack_from('<I',b)[0]==0xfeedfacf
 count=struct.unpack_from('<I',b,16)[0];at=32;regions=[];debug=[]
 for _ in range(count):
  cmd,size=struct.unpack_from('<II',b,at);assert size>=8 and at+size<=len(b)
  if cmd==0x1b:regions.append(('LC_UUID',at+8,16))
  if cmd==0x1d:
   off,n=struct.unpack_from('<II',b,at+8);assert off+n<=len(b);regions.extend([('LC_CODE_SIGNATURE-command',at,size),('LC_CODE_SIGNATURE-data',off,n)])
  if cmd==0x2:
   symoff,nsyms,stroff,strsize=struct.unpack_from('<IIII',b,at+8);assert symoff+nsyms*16<=len(b) and stroff+strsize<=len(b)
   for i in range(nsyms):
    s=symoff+16*i;strx,typ,sect,desc,value=struct.unpack_from('<IBBHQ',b,s)
    if typ==0x66:
     assert strx<strsize;assert b.find(b'\0',stroff+strx,stroff+strsize)>=0
     regions.append(('N_OSO-debug-st_mtime',s+8,8));debug.append({'symbolIndex':i,'type':typ,'section':sect,'descriptor':desc,'value':value,'offset':s+8})
  at+=size
 norm=bytearray(b)
 for kind,off,n in regions:norm[off:off+n]=bytes(n)
 return {'normalizedSha256':sha(norm),'debugObjectTimes':debug,'normalizedRanges':[{'kind':k,'offset':o,'bytes':n}for k,o,n in regions]}
report=[]
for item in json.loads((root/'result.json').read_text())['changedEntries']:
 rel=item['path'];states=[]
 for ver,label in [('021','before'),('022','after')]:
  p=Path('/private/tmp/willyou-m12-s2-package-'+ver+'/mac-arm64/WillYou.app/Contents/Resources/app.asar.unpacked')/rel;b=p.read_bytes();assert sha(b)==item[label]['sha256'];states.append(parse(b))
 x,y=states;report.append({'path':rel,'allOtherBytesEqualAfterExactDeclaredMetadataNormalization':x['normalizedSha256']==y['normalizedSha256'],'before':x,'after':y})
result={'scope':'Pure MachO byte analysis, exact LC_UUID/code-signature and SDK-defined N_OSO debug-object st_mtime only; not runtime validation or claim of binary identity','sdkHeaders':[{'path':str(p),'sha256':sha(p.read_bytes())}for p in headers],'files':report,'Native':0,'formalNewPasses':0}
(root/'native-metadata-delta.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps([{'path':x['path'],'onlyDeclaredMetadataDiffers':x['allOtherBytesEqualAfterExactDeclaredMetadataNormalization'],'debugSymbols':len(x['before']['debugObjectTimes'])}for x in report]))
