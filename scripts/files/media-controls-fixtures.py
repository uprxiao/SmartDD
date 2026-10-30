"""Own silent video fixtures; no user files or network."""
from pathlib import Path
import json,hashlib,tempfile,subprocess,shutil,datetime,wave
root=Path(tempfile.mkdtemp(prefix='willyou-media-controls-fixtures-',dir='/private/tmp'));project=root/'project';project.mkdir();ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe');assert ffmpeg and ffprobe
rows=[];commands=[]
for name,codec in [('clip-a.mp4','libx264'),('unsupported.mp4','mpeg4')]:
 cmd=[ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=12','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-map','0:v:0','-map','1:a:0','-t','30','-c:v',codec,'-pix_fmt','yuv420p','-c:a','aac','-b:a','32k','-movflags','+faststart']
 if codec=='libx264':cmd+=['-preset','ultrafast']
 cmd+=[str(project/name)];r=subprocess.run(cmd,capture_output=True,text=True,timeout=45);commands.append({'command':cmd,'exit':r.returncode,'stderr':r.stderr});assert r.returncode==0,r.stderr
shutil.copy2(project/'clip-a.mp4',project/'clip-b.mp4')
with wave.open(str(project/'control.wav'),'wb')as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);w.writeframes(b'\0'*96000)
for p in sorted(project.iterdir()):
 probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(p)],text=True));rows.append({'name':p.name,'kind':'audio'if p.suffix=='.wav'else'video','size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'streams':[{k:x[k]for k in ['codec_type','codec_name','width','height','duration']if k in x}for x in probe['streams']],'duration':probe['format']['duration']})
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(project),'source':'Own ffmpeg testsrc2 and anullsrc, original encoded H264/AAC and MPEG4/AAC; no user media.','commands':commands,'cases':rows};(root/'fixtures.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'projectPath':str(project),'manifest':str(root/'fixtures.json'),'cases':4}))
