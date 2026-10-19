"""Own silent duration/decoder edge fixtures; no user media or network."""
from pathlib import Path
import datetime,hashlib,json,shutil,struct,subprocess,tempfile,wave
base=Path(tempfile.mkdtemp(prefix='willyou-media-state-',dir='/private/tmp'));project=base/'project';project.mkdir()
ffmpeg=shutil.which('ffmpeg');assert ffmpeg
commands=[]
def make(name,options,seconds='3'):
 command=[ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t',seconds,*options,str(project/name)]
 result=subprocess.run(command,capture_output=True,text=True,timeout=30);commands.append({'args':command,'code':result.returncode,'stderr':result.stderr});assert result.returncode==0,result.stderr
make('normal.wav',['-c:a','pcm_s16le'])
with wave.open(str(project/'zero.wav'),'wb')as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);w.writeframes(b'')
make('live-webm.opus',['-c:a','libopus','-b:a','32k','-f','webm','-live','1'])
make('normal.opus',['-c:a','libopus','-b:a','32k','-f','ogg'])
original=(project/'normal.opus').read_bytes();pages=[];offset=0
while offset<len(original):
 assert original[offset:offset+4]==b'OggS';segments=original[offset+26];size=27+segments+sum(original[offset+27:offset+27+segments]);pages.append((offset,size));offset+=size
assert offset==len(original)
def crc(data):
 value=0
 for b in data:
  value^=b<<24
  for _ in range(8):value=((value<<1)^0x04c11db7 if value&0x80000000 else value<<1)&0xffffffff
 return value
for name,unknown in [('no-eos.opus',False),('unknown-granule.opus',True)]:
 data=bytearray(original);at,size=pages[-1];data[at+5]&=~4
 if unknown:data[at+6:at+14]=b'\xff'*8
 data[at+22:at+26]=b'\x00'*4;data[at+22:at+26]=struct.pack('<I',crc(data[at:at+size]));(project/name).write_bytes(data)
make('short.opus',['-c:a','libopus','-b:a','32k','-f','ogg'],'0.02')
make('empty.opus',['-c:a','libopus','-b:a','32k','-f','ogg'],'0')
short=(project/'short.opus').read_bytes();at=short.rfind(b'OggS');assert at>=0
head=short.find(b'OpusHead');assert head>=0;preskip=struct.unpack('<H',short[head+10:head+12])[0]
for name,granule in [('zero-granule.opus',preskip),('below-preskip.opus',0)]:
 data=bytearray(short);data[at+6:at+14]=struct.pack('<Q',granule);data[at+22:at+26]=b'\x00'*4;data[at+22:at+26]=struct.pack('<I',crc(data[at:]));(project/name).write_bytes(data)
(project/'broken.wav').write_bytes(b'Explicit invalid audio fixture; no decodable track')
cases=[{'name':p.name,'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(project.iterdir())]
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'project':str(project),'cases':cases,'commands':commands,'ffmpegVersion':subprocess.check_output([ffmpeg,'-version'],text=True).splitlines()[0],'boundary':'All silent generated media. live-webm.opus deliberately declares an Opus extension over a live WebM container to explore decoder handling, not a valid Ogg-format conformance claim. Ogg no-EOS/unknown granule fixtures retain complete packets and recomputed page CRC; decoder duration/outcome measured, not assumed.'};(base/'fixtures.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'manifest':str(base/'fixtures.json'),'project':str(project),'cases':len(cases)}))
