"""V08 owned GIF/PNG corpus; extension/MIME differences are explicit."""
from pathlib import Path
import datetime, hashlib, json, shutil, struct, subprocess, tempfile, zlib

base = Path(tempfile.mkdtemp(prefix='willyou-image-animation-fixtures-', dir='/private/tmp'))
project = base/'project'
project.mkdir()
def chunk(kind, data):
    return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data))
pixels = b''.join(b'\0'+bytes([32, 170, 128, 255])*40 for _ in range(30))
png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('>IIBBBBB',40,30,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')
(project/'static.png').write_bytes(png)
(project/'static-looking.gif').write_bytes(png)
for index, color in enumerate([[220,30,40],[20,190,90]]):
    (base/f'frame-{index}.ppm').write_bytes(b'P6\n40 30\n255\n'+bytes(color)*1200)
command = [shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-nostdin','-n','-framerate','5','-i',str(base/'frame-%d.ppm'),'-loop','0',str(project/'animated.gif')]
subprocess.run(command,check=True,capture_output=True)
shutil.copyfile(project/'animated.gif', project/'animation-looking.png')
cases=[]
for name, mime, animated, codec, frames in [('animated.gif','image/gif',True,'gif',2),('static.png','image/png',False,'png',1),('static-looking.gif','image/png',False,'png',1),('animation-looking.png','image/gif',True,'gif',2)]:
    path=project/name
    probe=json.loads(subprocess.check_output([shutil.which('ffprobe'),'-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames','-of','json',str(path)]))['streams'][0]
    assert probe['codec_name']==codec and int(probe['nb_read_frames'])==frames
    decoded=subprocess.check_output([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-nostdin','-i',str(path),'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgba','-'])
    assert len(decoded)==40*30*4*frames
    expected_pixels=[','.join(map(str,decoded[offset+(15*40+20)*4:offset+(15*40+20)*4+4]))for offset in range(0,len(decoded),40*30*4)]
    cases.append({'name':name,'mime':mime,'hostAnimated':animated,'actualCodec':codec,'actualFrames':frames,'expectedFramePixels':expected_pixels,'width':40,'height':30,'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'probe':probe})
markdown='images.md'
(project/markdown).write_text('# V08 own image animation boundaries\n\n'+'\n\n'.join(f'![{c["name"]}]({c["name"]})' for c in cases)+'\n')
record={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':str(base),'project':str(project),'markdown':markdown,'cases':cases,'command':command,'boundary':'Own synthetic40x30 GIF(two actual frames),PNG(one frame),and byte-identical alternate .gif/.png names. Actual FileService classifyFile uses source magic before filename; host animation follows issued MIME, not menu URL guessing or general frame counting. Initial incorrect extension-only fixture expectation is retained separately. No network,user files,clipboard or native picker.'}
(base/'fixtures.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'manifest':str(base/'fixtures.json'),'project':str(project)}))
