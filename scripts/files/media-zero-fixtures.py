"""Additional silent, byte-level media-duration fault fixtures; never user media.

These are decoder observations, not claims that contradictory metadata is valid.
The previous empty-WAV and Opus-granule experiments are deliberately not repeated.
"""
from pathlib import Path
import datetime, hashlib, json, shutil, struct, subprocess, tempfile

b = Path(tempfile.mkdtemp(prefix='willyou-media-zero-', dir='/private/tmp'))
project = b/'project'; project.mkdir()
ffmpeg = shutil.which('ffmpeg'); assert ffmpeg
commands = []
def make(name, codec, seconds, extra):
    args = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
            '-i', 'anullsrc=r=48000:cl=mono', '-t', seconds, '-c:a', codec, *extra, str(project/name)]
    p = subprocess.run(args, capture_output=True, text=True, timeout=30)
    commands.append({'args':args,'exit':p.returncode,'stderr':p.stderr}); assert p.returncode == 0
make('control.m4a','aac','1',['-b:a','32k','-movflags','+faststart'])
make('webm-seed.opus','libopus','1',['-b:a','32k','-f','webm'])
make('empty-webm.opus','libopus','0',['-b:a','32k','-f','webm'])
make('empty-vorbis.ogg','libvorbis','0',['-f','ogg'])

containers = {b'moov',b'trak',b'mdia',b'minf',b'stbl',b'edts'}
def boxes(data, start=0, end=None):
    end = len(data) if end is None else end
    while start < end:
        assert end-start >= 8
        size, kind = struct.unpack_from('>I4s',data,start); header = 8
        if size == 1:size = struct.unpack_from('>Q',data,start+8)[0]; header=16
        if size == 0:size=end-start
        assert size >= header and start+size <= end
        payload=start+header
        yield kind,payload,start+size
        if kind in containers:yield from boxes(data,payload,start+size)
        start += size
changes = {}
seed=(project/'control.m4a').read_bytes()
for name, fields in [('stts-zero.m4a',{'stts'}),('all-times-zero.m4a',{'stts','mvhd','tkhd','mdhd','elst'})]:
    data=bytearray(seed); rows=[]
    for kind,payload,end in boxes(data):
        tag=kind.decode('ascii')
        if tag not in fields:continue
        assert data[payload]==0, 'This fixture parser only patches version0 timing fields'
        offsets=[]
        if tag in ['mvhd','mdhd']:offsets=[payload+16]
        elif tag=='tkhd':offsets=[payload+20]
        elif tag=='stts':
            count=struct.unpack_from('>I',data,payload+4)[0]
            offsets=[payload+12+8*i for i in range(count)]
        elif tag=='elst':
            count=struct.unpack_from('>I',data,payload+4)[0]
            offsets=[payload+8+12*i for i in range(count)]
        for at in offsets:
            assert at+4<=end
            old=struct.unpack_from('>I',data,at)[0];struct.pack_into('>I',data,at,0)
            rows.append({'box':tag,'offset':at,'old':old,'new':0})
    assert rows; (project/name).write_bytes(data); changes[name]=rows

webm=bytearray((project/'webm-seed.opus').read_bytes()); marker=b'\x44\x89\x88'
at=webm.find(marker);assert at>=0 and webm.find(marker,at+1)<0
old=struct.unpack_from('>d',webm,at+3)[0];struct.pack_into('>d',webm,at+3,0)
(project/'declared-zero.opus').write_bytes(webm)
changes['declared-zero.opus']=[{'field':'Matroska Duration','offset':at+3,'old':old,'new':0}]
names=['control.m4a','stts-zero.m4a','all-times-zero.m4a','declared-zero.opus','empty-webm.opus','empty-vorbis.ogg']
cases=[{'name':name,'size':(project/name).stat().st_size,'sha256':hashlib.sha256((project/name).read_bytes()).hexdigest(),'timingChanges':changes.get(name,[])}for name in names]
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'project':str(project),'cases':cases,'commands':commands,'ffmpegVersion':subprocess.check_output([ffmpeg,'-version'],text=True).splitlines()[0],'boundary':'Silent local files only. Two MP4 timing patches and one explicit Matroska duration patch are deliberately contradictory metadata fault fixtures, not conformant export claims. WebM/Opus uses an Opus audio filename to enter the existing audio route, same as prior container observations; no native DOM/media values or APIs changed. Zero-duration reachability is measured, never inferred from these field values.'}
(b/'fixtures.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'manifest':str(b/'fixtures.json'),'project':str(project),'cases':len(cases)}))
