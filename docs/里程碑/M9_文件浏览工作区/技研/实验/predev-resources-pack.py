#!/usr/bin/env python3
"""Independent native resource trial pack; not a WillYou installer/release."""
import gzip,hashlib,json,os,pathlib,shutil,subprocess,tarfile,time
ROOT=pathlib.Path('/private/tmp/m9-predev-resources')
REPO=pathlib.Path(__file__).resolve().parents[5]
OUT=REPO/'docs/里程碑/M9_文件浏览工作区/验收/证据/predev-resources'
stage=ROOT/'native-pack-stage';stage.mkdir(exist_ok=True)
shutil.copyfile('/private/tmp/m9-r34-tex/tectonic',stage/'tectonic');os.chmod(stage/'tectonic',0o755)
for name in ['willyou-tex-v33-candidate.zip','predev-tex-resource-manifest.json']:shutil.copyfile(ROOT/name,stage/name)
shutil.copytree(ROOT/'temurin21',stage/'jre',dirs_exist_ok=True,symlinks=True)
shutil.copytree('/tmp/predev-office-poi/lib',stage/'poi-lib',dirs_exist_ok=True)
shutil.copytree(OUT/'licenses',stage/'notices',dirs_exist_ok=True)
items=[]
for p in sorted(stage.rglob('*')):
    if p.is_symlink():items.append({'path':str(p.relative_to(stage)),'type':'symlink','target':os.readlink(p)})
    elif p.is_file():items.append({'path':str(p.relative_to(stage)),'type':'file','bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
archive=ROOT/'willyou-native-resource-trial.tar.gz'
with archive.open('wb') as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0,compresslevel=6) as zipped,tarfile.open(fileobj=zipped,mode='w') as tar:
    def normalize(info):info.uid=0;info.gid=0;info.uname='';info.gname='';info.mtime=0;return info
    tar.add(stage,arcname='resources',filter=normalize)
dest=ROOT/'relocated 中文 space'
if dest.exists():shutil.rmtree(dest)
dest.mkdir()
with tarfile.open(archive) as tar:
    for m in tar:
        target=(dest/m.name).resolve();assert target.is_relative_to(dest.resolve())
        if m.issym():assert (target.parent/m.linkname).resolve().is_relative_to(dest.resolve())
    tar.extractall(dest,filter='data')
resources=dest/'resources';checks=[]
for item in items:
    p=resources/item['path']
    if item['type']=='file':assert hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256']
    else:assert p.is_symlink() and os.readlink(p)==item['target']
checks.append({'id':'RES-PACK-01','status':'passed','detail':f"{len(items)} files/symlinks extracted with exact hash/target"})
java=next((resources/'jre').rglob('bin/java'));result=subprocess.run([str(java),'-version'],capture_output=True,text=True,timeout=10)
checks.append({'id':'RES-PACK-02','status':'passed' if result.returncode==0 and 'Temurin-21.0.12.1+1' in result.stderr else 'failed','detail':result.stderr})
sub=OUT/'relocated';sub.mkdir(exist_ok=True)
result=subprocess.run(['python3',str(pathlib.Path(__file__).with_name('predev-tex-probe.py')),str(resources),str(sub),str(resources/'tectonic')],capture_output=True,text=True,timeout=180)
checks.append({'id':'RES-PACK-03','status':'passed' if result.returncode==0 else 'failed','detail':result.stdout+result.stderr})
for filename in ['oa12-deleted.xlsx','rich-delete-final.xlsx']:
    result=subprocess.run([str(java),'-Xmx512m','-Dlog4j2.statusLoggerLevel=OFF','-cp',f'/tmp/predev-office-poi/classes:{resources}/poi-lib/*','PoiProbe','read',f'/tmp/predev-office-attempt5/{filename}'],capture_output=True,text=True,timeout=20)
    data=json.loads(result.stdout);checks.append({'id':'RES-PACK-04' if filename.startswith('oa12') else 'RES-PACK-05','status':'passed' if result.returncode==0 and all(not c['exception'] for c in data['cells']) else 'failed','detail':data})
report={'schema':'m9-independent-resource-pack-v1','archive':str(archive),'archiveBytes':archive.stat().st_size,'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest(),'uncompressedRegularBytes':sum(i.get('bytes',0) for i in items),'entries':items,'checks':checks,'summary':{'passed':sum(c['status']=='passed' for c in checks),'failed':sum(c['status']=='failed' for c in checks)},'boundary':'Native resource trial only: TeX binary/bundle + Temurin JRE + POI jars + notices. No full App, LibreOffice, ASAR, sign/notarize or other OS result. POI bridge classes remain independent test fixtures.'}
(OUT/'predev-resources-pack-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']))
raise SystemExit(1 if report['summary']['failed'] else 0)
