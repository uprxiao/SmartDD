"""Minimal real archive containers; ZIP containers are not valid Office docs."""
from pathlib import Path
import bz2,datetime,gzip,hashlib,io,json,lzma,struct,subprocess,tarfile,tempfile,zipfile,zlib
base=Path(tempfile.mkdtemp(prefix='willyou-archives-',dir='/private/tmp'));project=base/'project';project.mkdir();payload=b'M9 synthetic archive payload, never execute.\n'*20
commands=[]
def run(args,data=None):
 commands.append(args);p=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode:raise RuntimeError(str(args)+': '+p.stderr.decode())
 return p.stdout
def zip_bytes(traversal=False):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED) as z:z.writestr('../outside-must-not-write.txt' if traversal else 'README.txt',payload)
 return b.getvalue()
tar_buffer=io.BytesIO()
with tarfile.open(fileobj=tar_buffer,mode='w',format=tarfile.USTAR_FORMAT) as t:
 info=tarfile.TarInfo('README.txt');info.size=len(payload);info.mtime=0;t.addfile(info,io.BytesIO(payload))
tar_bytes=tar_buffer.getvalue();seven=run(['/usr/bin/tar','--format=7zip','-cf','-','-T','/dev/null'])
def rar_header(header):
 body=bytes([len(header)])+bytes(header);return struct.pack('<I',zlib.crc32(body))+body
# Empty RAR5 volume: signature, main flags=0, end flags=0. Official format:
# https://www.rarlab.com/technote.htm . Independently listed by system bsdtar.
rar=b'Rar!\x1a\x07\x01\x00'+rar_header([1,0,0])+rar_header([5,0,0])
containers={'7z':seven,'Z':run(['/usr/bin/compress','-c'],payload),'bz2':bz2.compress(payload),'gz':gzip.compress(payload,mtime=0),'tar':tar_bytes,'tar.gz':gzip.compress(tar_bytes,mtime=0),'xz':lzma.compress(payload),'zst':run(['/opt/homebrew/bin/zstd','-q','-c'],payload),'rar':rar,'zip':zip_bytes()}
for extension,magic in [('7z',b"7z\xbc\xaf\x27\x1c"),('Z',b'\x1f\x9d'),('bz2',b'BZh'),('gz',b'\x1f\x8b'),('xz',b'\xfd7zXZ\0'),('zst',b'\x28\xb5\x2f\xfd'),('rar',b'Rar!\x1a\x07\x01\0'),('zip',b'PK\x03\x04')]:assert containers[extension].startswith(magic),extension
extensions=['7z','Z','apk','bz2','docm','docx','epub','gz','jar','odp','ods','odt','potm','potx','ppsm','ppsx','pptm','pptx','rar','tar','tar.gz','xlsm','xlsx','xpi','xz','zip','zst'];cases=[]
for ext in extensions:
 name='magic.'+ext;data=containers.get(ext,containers['zip']);(project/name).write_bytes(data);kind='office' if ext in ['docx','pptx','xlsx','xlsm'] else 'unsupported' if ext in ['odp','ods','odt'] else 'archive'
 if kind!='office':run(['/usr/bin/tar','-tf',str(project/name)]) if ext not in ['Z','bz2','gz','xz','zst'] else None
 cases.append({'name':name,'extension':ext,'kind':kind,'container':'archive','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'magic':data[:8].hex(),'officeContainerOnly':kind=='office'})
for ext in ['docx','pptx','xlsx','xlsm']:
 name='damaged.'+ext;data=b'Broken synthetic Office container, distinct parser failure.';(project/name).write_bytes(data);cases.append({'name':name,'extension':ext,'kind':'office','container':'archive','damaged':True,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
name='untrusted-path.zip';data=zip_bytes(True);(project/name).write_bytes(data);cases.append({'name':name,'extension':'zip','kind':'archive','container':'archive','traversalPayload':True,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
(base/'fixtures.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'project':str(project),'cases':cases,'commands':commands,'formatReference':'https://www.rarlab.com/technote.htm','scope':'27 actual minimum archive containers; ZIP-container Office aliases deliberately lack OOXML documents and must report parser errors. Generic archives are unsupported previews, not archive integrity/CRC validators. No extract command used.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'project':str(project),'cases':len(cases),'artifacts':str(base)}))
