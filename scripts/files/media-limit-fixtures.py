"""Own silent valid media plus sparse container padding at exact 128MiB boundaries."""
from pathlib import Path
import datetime,hashlib,json,shutil,struct,subprocess,tempfile,wave
root=Path(tempfile.mkdtemp(prefix='willyou-media-limit-',dir='/private/tmp'));project=root/'project';project.mkdir();limit=128*1024*1024;ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe');assert ffmpeg and ffprobe
wav=root/'base.wav'
with wave.open(str(wav),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000);f.writeframes(bytes(96000))
mp4=root/'base.mp4';command=[ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x48:rate=8','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','1','-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(mp4)];subprocess.run(command,check=True,capture_output=True,timeout=45)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
cases=[]
for kind,base,suffix in [('audio',wav,'.wav'),('video',mp4,'.mp4')]:
 for delta,label in [(-1,'below'),(0,'equal'),(1,'above')]:
  size=limit+delta;path=project/(kind+'-'+label+suffix);shutil.copyfile(base,path)
  with path.open('r+b') as f:
   f.seek(0,2)
   if kind=='video':f.write(struct.pack('>I4s',size-base.stat().st_size,b'free'))
   else:
    even=size-size%2;f.write(struct.pack('<4sI',b'JUNK',even-base.stat().st_size-8));f.seek(4);f.write(struct.pack('<I',even-8))
   f.truncate(size)
  probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(path)],text=True,timeout=30));streams=[{k:s[k] for k in ['codec_name','codec_type','sample_rate','channels','width','height','duration'] if k in s}for s in probe['streams']];assert any(s['codec_type']==kind for s in streams);assert .9<float(probe['format']['duration'])<1.2;st=path.stat();cases.append({'name':path.name,'kind':kind,'size':st.st_size,'delta':delta,'sha256':sha(path),'streams':streams,'probeDuration':float(probe['format']['duration']),'padding':'MP4 free box' if kind=='video'else'WAV JUNK plus one unreferenced trailer byte for odd total; RIFF core remains even-sized'});assert st.st_size==size
m={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(project),'limit':limit,'source':'Own synthetic silent WAV, silent AAC/H264 test pattern MP4; sparse padding counts toward real FD size; no user media/network','ffmpegCommand':command,'ffmpegVersion':subprocess.check_output([ffmpeg,'-version'],text=True).splitlines()[0],'cases':cases};(root/'fixtures.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'root':str(root),'project':str(project),'manifest':str(root/'fixtures.json'),'cases':len(cases)}))
