"""Synthetic silent media fixtures; never reads user media or uses the network."""
from pathlib import Path
import datetime,hashlib,json,shutil,subprocess,tempfile

root=Path(tempfile.mkdtemp(prefix='willyou-media-formats-',dir='/private/tmp'))
project=root/'project';project.mkdir()
ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe')
assert ffmpeg and ffprobe
cases=[];commands=[]
def make(name,kind,options,video=False):
 path=project/name
 command=[ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
 if video:command+=['-f','lavfi','-i','testsrc2=size=320x180:rate=12','-map','1:v:0','-map','0:a:0']
 command+=['-t','8',*options,str(path)]
 done=subprocess.run(command,capture_output=True,text=True,timeout=45)
 commands.append({'arguments':command,'returncode':done.returncode,'stderr':done.stderr})
 assert done.returncode==0,done.stderr
 probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(path)],text=True))
 streams=[{k:s[k] for k in ['codec_name','codec_type','sample_rate','channels','width','height','duration'] if k in s} for s in probe['streams']]
 cases.append({'name':name,'kind':kind,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':path.stat().st_size,'streams':streams,'format':probe['format']['format_name'],'probeDuration':float(probe['format']['duration'])})

for suffix,options in [
 ('aac',['-c:a','aac','-b:a','64k','-f','adts']),
 ('flac',['-c:a','flac']),('m4a',['-c:a','aac','-b:a','64k','-f','mp4']),
 ('mp3',['-c:a','libmp3lame','-b:a','64k']),('mp4a',['-c:a','aac','-b:a','64k','-f','mp4']),
 ('oga',['-c:a','vorbis','-strict','experimental','-f','ogg']),
 ('ogg',['-c:a','vorbis','-strict','experimental','-f','ogg']),
 ('opus',['-c:a','libopus','-b:a','48k','-f','opus']),('wav',['-c:a','pcm_s16le'])]:
 make('audio.'+suffix,'audio',options)
make('video.mp4','video',['-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart'],True)
# FFmpeg's official Ogg muxer supports VP8 headers; local build has no Theora
# encoder. This is a real Ogg video, not renamed WebM. Decode support is measured.
make('video.ogv','video',['-c:v','libvpx','-deadline','realtime','-cpu-used','8','-b:v','160k','-c:a','libopus','-b:a','48k','-f','ogg'],True)
make('video.webm','video',['-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-b:v','160k','-c:a','libopus','-b:a','48k'],True)
make('unsupported-codec.mp4','video',['-c:v','mpeg4','-q:v','10','-c:a','aac','-b:a','64k'],True)
cases[-1]['unsupportedCodec']=True
for name,kind in [('broken.wav','audio'),('broken.mp4','video')]:
 path=project/name;path.write_bytes(b'M9 deliberately invalid media; not a valid encoded stream')
 cases.append({'name':name,'kind':kind,'invalid':True,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':path.stat().st_size})
oracle={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectPath':str(project),'source':'Local ffmpeg synthetic silent audio and testsrc2 video; no user media.','formatReference':'https://ffmpeg.org/doxygen/trunk/oggenc_8c_source.html','ffmpegVersion':subprocess.check_output([ffmpeg,'-version'],text=True).splitlines()[0],'commands':commands,'cases':cases}
(root/'fixtures.json').write_text(json.dumps(oracle,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'projectPath':str(project),'fixtures':len(cases),'manifest':str(root/'fixtures.json')}))
