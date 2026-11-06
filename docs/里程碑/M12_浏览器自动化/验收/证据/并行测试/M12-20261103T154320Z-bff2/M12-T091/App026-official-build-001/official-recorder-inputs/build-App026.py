#!/usr/bin/python3
"""Thin Root-only recorder around the unchanged official release/build.mjs command."""
import argparse, datetime, hashlib, json, os, stat, subprocess, time
from pathlib import Path

REPO=Path('/Users/liubu/hx/4.uprxiao/SmartDD')
NODE='/Users/liubu/.hermes/node/bin/node'
SOURCE=Path('/private/tmp/willyou-m12-t091-source-030/source-inputs.json')
ROOT=Path('/private/tmp/willyou-m12-t091-App026-build-001')
OUTPUT=Path('/private/tmp/willyou-m12-s2-package-026')
APP=OUTPUT/'mac-arm64/WillYou.app'
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def check(j):
    for rel,want in j['files'].items():
        for base in [REPO,Path(j['source'])]:
            f=base/rel
            assert f.is_file() and not f.is_symlink() and f.resolve()==f, 'Source missing/link: '+rel
            assert sha(f)==want and stat.S_IMODE(f.stat().st_mode)==j['modes'][rel], 'Source moved: '+rel
def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true',required=True);p.add_argument('--source-sha',required=True);a=p.parse_args()
    assert os.environ.get('WILLYOU_APP026_ROOT_EXCLUSIVE')=='1', 'Root exclusive build lease required'
    assert os.environ.get('WILLYOU_APP026_REGRESSIONS_ACCEPTED')=='1', 'Root must first accept actual regressions'
    assert sha(SOURCE)==a.source_sha
    j=json.loads(SOURCE.read_text());check(j)
    assert not OUTPUT.exists() and not ROOT.exists(), 'Preserve original output/attempt'
    cache=ROOT/'cache';(cache/'tmp').mkdir(parents=True);(cache/'xdg').mkdir()
    command=[NODE,'scripts/release/build.mjs','--dir','--output-dir',str(OUTPUT)]
    env={**os.environ,'SMARTDD_SIGN':'0','CSC_IDENTITY_AUTO_DISCOVERY':'false','TMPDIR':str(cache/'tmp'),
         'WILLYOU_TEST_CACHE_DIR':str(cache),'XDG_CACHE_HOME':str(cache/'xdg'),'NODE_COMPILE_CACHE':str(cache/'node')}
    started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic();code=None;source_ok=False
    with (ROOT/'build.private.log').open('wb') as log:
        child=subprocess.Popen(command,cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT)
        (ROOT/'started.json').write_text(json.dumps({'at':started,'coordinatorPid':os.getpid(),'buildPid':child.pid,'command':command,'cwd':str(REPO),'sourceManifestSha256':a.source_sha},indent=2)+'\n')
        try: code=child.wait()
        finally:
            try:check(j);source_ok=True
            finally:
                record={'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'seconds':time.monotonic()-t,
                  'exitCode':code,'sourceManifestSha256':a.source_sha,'sourceFiles':len(j['files']),'sourceShaModeBeforeAfterMatched':source_ok,
                  'actualApp':str(APP),'boundary':'Local arm64 official directory build; no installer/DeveloperID/notarization/x64/publish','formalIncrement':0}
                if code==0 and APP.exists():
                    res=APP/'Contents/Resources';record['pins']={name:sha(path) for name,path in {
                        'app.asar':res/'app.asar','executable':APP/'Contents/MacOS/WillYou','stockCLI':res/'native/willyou-app',
                        'agent-browser':res/'agent-browser/arm64/agent-browser','identity':res/'native/willyou-process-identity'}.items()}
                    record['nativeCliProvenance']={'source':'native/applications/cli.mm','sourceSha256':j['files']['native/applications/cli.mm'],
                        'recipe':'scripts/applications/build.mjs','recipeSha256':j['files']['scripts/applications/build.mjs'],
                        'generatedVia':'electron.vite.config.ts main writeBundle -> scripts/applications/build.mjs -> buildApplicationCli',
                        'packagedAfterSigningSha256':record['pins']['stockCLI'],'outBeforeSigningSha256':sha(REPO/'out/native/willyou-app')}
                    text=(ROOT/'build.private.log').read_text(errors='replace');smoke=[]
                    for line in text.splitlines():
                        try:v=json.loads(line)
                        except (ValueError,TypeError):continue
                        if isinstance(v,dict) and all(v.get(k)=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']):smoke.append(v)
                    record['nativeSmokeRecords']=smoke
                (ROOT/'result.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    assert code==0 and source_ok, 'Preserve first failed build; diagnose before retry'
    assert len(record.get('nativeSmokeRecords',[]))==1, 'Official six-native terminal result missing/ambiguous'
    print(json.dumps({'result':str(ROOT/'result.json'),'pins':record['pins'],'sourceUnchanged':True},ensure_ascii=False))
if __name__=='__main__':main()
