"""Generate public, synthetic raster acceptance files using installed encoders."""
from pathlib import Path
import datetime, hashlib, json, shutil, subprocess, tempfile

base=Path(tempfile.mkdtemp(prefix='willyou-raster-ui-',dir='/private/tmp'))
project=base/'project';project.mkdir();inputs=base/'encoder-inputs';inputs.mkdir()
commands=[]
def run(args):
    commands.append(args)
    result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    with (base/'encoders.log').open('a') as log:log.write(result.stdout+'\n')
    if result.returncode:raise RuntimeError('Synthetic fixture encoder failed; see '+str(base/'encoders.log'))
    return result.stdout
def ppm(name,width,height,color):
    path=inputs/name;path.write_bytes(f'P6\n{width} {height}\n255\n'.encode()+bytes(color)*(width*height));return path
source=ppm('source.ppm',40,30,[32,170,128]);icon=ppm('icon.ppm',32,32,[32,170,128]);avif=ppm('avif.ppm',64,64,[32,170,128])
ffmpeg=shutil.which('ffmpeg');ffprobe=shutil.which('ffprobe');cwebp=shutil.which('cwebp')
assert ffmpeg and ffprobe and cwebp
cases=[]
for extension,mime in [('avif','image/avif'),('bmp','image/bmp'),('gif','image/gif'),('ico','image/x-icon'),('jpeg','image/jpeg'),('jpg','image/jpeg'),('png','image/png'),('webp','image/webp')]:
    path=project/('valid.'+extension);width,height=(64,64) if extension=='avif' else (32,32) if extension=='ico' else (40,30)
    src=avif if extension=='avif' else icon if extension=='ico' else source
    if extension=='webp':run([cwebp,'-quiet','-lossless',str(src),'-o',str(path)])
    else:
        args=[ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-n','-i',str(src),'-frames:v','1']
        if extension=='avif':args+=['-c:v','libsvtav1','-preset','13','-svtav1-params','lp=1','-pix_fmt','yuv420p']
        if extension in ['jpeg','jpg']:args+=['-pix_fmt','yuvj420p']
        run(args+[str(path)])
    probe=json.loads(run([ffprobe,'-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',str(path)]))['streams'][0]
    assert (probe['width'],probe['height'])==(width,height)
    cases.append({'name':path.name,'kind':'image','mime':mime,'width':width,'height':height,'probe':probe})
    broken=project/('broken.'+extension);broken.write_text('Broken synthetic '+extension+' image, not a valid decoder stream.\n')
    cases.append({'name':broken.name,'kind':'image','mime':mime,'decodeFailure':True})
for number,color in enumerate([[220,30,40],[20,190,90]]):ppm(f'frame-{number}.ppm',40,30,color)
animation=project/'animated.gif';run([ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-n','-framerate','5','-i',str(inputs/'frame-%d.ppm'),'-loop','0',str(animation)])
probe=json.loads(run([ffprobe,'-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',str(animation)]))['streams'][0];assert int(probe['nb_read_frames'])==2
cases.append({'name':animation.name,'kind':'image','mime':'image/gif','width':40,'height':30,'animation':True,'probe':probe})
alpha=inputs/'alpha.rgba';alpha.write_bytes(b''.join(bytes([32,170,128,0 if x<20 else 255]) for y in range(30) for x in range(40)))
transparent=project/'transparent.png';run([ffmpeg,'-hide_banner','-loglevel','error','-nostdin','-n','-f','rawvideo','-pixel_format','rgba','-video_size','40x30','-i',str(alpha),'-frames:v','1',str(transparent)])
cases.append({'name':transparent.name,'kind':'image','mime':'image/png','width':40,'height':30,'transparent':True})
for case in cases:case['sha256']=hashlib.sha256((project/case['name']).read_bytes()).hexdigest()
record={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'project':str(project),'scope':'Synthetic encoder inputs only; no downloaded or user images. ffprobe verifies real encoded dimensions/frame count; App decoder checked separately.','commands':commands,'cases':cases}
(base/'fixtures.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'project':str(project),'cases':len(cases),'artifacts':str(base)}))
