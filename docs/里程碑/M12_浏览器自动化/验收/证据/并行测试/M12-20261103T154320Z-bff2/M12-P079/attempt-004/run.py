#!/usr/bin/env python3
"""Private controlled measurement runner. Native/compiler execution requires --execute.
No imports of psutil/ctypes and no OS process queries during static preparation.
"""
import argparse,hashlib,json,os,selectors,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SDK=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,data):
    path=Path(path);temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def records(path):
    out=[]
    if path.exists():
        for number,line in enumerate(path.read_text(errors='replace').splitlines(),1):
            try:out.append(json.loads(line))
            except Exception:out.append({'kind':'unparsed-output','line':number,'raw':line})
    return out

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
    if not args.execute:raise SystemExit('Static READY is produced by prepare.py; Native/compiler execution requires explicit coordinator lease and --execute.')
    # Only file reads precede the strict preflight gate.
    pin=json.loads((ROOT/'static-preflight.json').read_text())
    for item in pin['inputs']:
        if sha(item['path'])!=item['sha256']:raise SystemExit('Input SHA mismatch: '+item['path'])
    expected_cache=str(ROOT/'cache')
    if os.environ.get('WILLYOU_TEST_CACHE_DIR')!=expected_cache:raise SystemExit('Private WILLYOU_TEST_CACHE_DIR mismatch')
    if (ROOT/'execution-started.json').exists():raise SystemExit('This root is single-use; preserve prior attempt and prepare a new root.')
    (ROOT/'cache').mkdir(exist_ok=True);(ROOT/'build').mkdir(exist_ok=True)
    save(ROOT/'execution-started.json',{'atEpoch':time.time(),'runnerPid':os.getpid(),'command':[sys.executable,str(ROOT/'run.py'),'--execute'],'preflightSha256':sha(ROOT/'static-preflight.json'),'boundaries':'controlled compiler+Native only; no App/network/PTY/UI/keychain; no production changes'})
    env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','TMPDIR':str(ROOT/'cache'),'WILLYOU_TEST_CACHE_DIR':expected_cache,'LC_ALL':'C'}
    binary=ROOT/'build/probe';compiler=['/usr/bin/clang','-v','-std=c11','-Wall','-Wextra','-Werror','-O1','-isysroot',str(SDK),'-mmacosx-version-min=13.0','-MD','-MF',str(ROOT/'build/probe.d'),str(ROOT/'probe.c'),'-o',str(binary),'-lproc']
    execution={'runnerPid':os.getpid(),'compiler':{'command':compiler},'probe':{},'auxiliary':[],'errors':[]}
    identities={};probe=None;forced=False
    try:
        with (ROOT/'build/stdout.log').open('wb') as out,(ROOT/'build/stderr.log').open('wb') as err:
            compiler_process=subprocess.Popen(compiler,cwd=ROOT,env=env,stdout=out,stderr=err)
            execution['compiler']['pid']=compiler_process.pid;save(ROOT/'live.json',execution)
            try:code=compiler_process.wait(timeout=6)
            except subprocess.TimeoutExpired:
                compiler_process.terminate()
                try:compiler_process.wait(timeout=1)
                except subprocess.TimeoutExpired:compiler_process.kill();compiler_process.wait(timeout=1)
                raise RuntimeError('controlled-fixture compiler timeout; no probe business started')
            execution['compiler'].update({'returnCode':code,'actualExitCode':code if code>=0 else None,'signal':-code if code<0 else None})
            save(ROOT/'live.json',execution)
            if code!=0:raise RuntimeError('controlled-fixture compile failed; retain logs, do not execute')
        execution['compiler']['binarySha256']=sha(binary)
        # clang -MD retains the actual transitive SDK dependency closure after compilation.
        dependency_text=(ROOT/'build/probe.d').read_text().replace('\\\n',' ')
        import shlex
        dep_paths=shlex.split(dependency_text.split(':',1)[1])
        dependencies=[]
        for item in sorted(set(dep_paths)):
            p=Path(item)
            if p.is_file():dependencies.append({'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size})
        save(ROOT/'build/actual-dependencies.json',{'inputs':dependencies,'sourceSha256':sha(ROOT/'probe.c'),'binarySha256':sha(binary)})
        probe=subprocess.Popen([str(binary)],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,bufsize=0)
        execution['probe']={'pid':probe.pid,'command':[str(binary)],'startedMonotonic':time.monotonic(),'returnCode':None,'actualExitCode':None,'signal':None,'terminationByRunner':False}
        save(ROOT/'live.json',execution)
        selector=selectors.DefaultSelector();selector.register(probe.stdout,selectors.EVENT_READ,'stdout');selector.register(probe.stderr,selectors.EVENT_READ,'stderr')
        buffers={'stdout':b'','stderr':b''};start=time.monotonic()
        with (ROOT/'native-stdout.jsonl').open('wb') as out,(ROOT/'native-stderr.log').open('wb') as err:
            while selector.get_map():
                if time.monotonic()-start>10 and probe.poll() is None:
                    forced=True;execution['probe']['terminationByRunner']=True;probe.terminate();execution['errors'].append({'kind':'probe-timeout','elapsedSeconds':time.monotonic()-start});save(ROOT/'live.json',execution)
                    try:probe.wait(timeout=1)
                    except subprocess.TimeoutExpired:probe.kill();probe.wait(timeout=1)
                for key,_ in selector.select(timeout=.25):
                    block=os.read(key.fileobj.fileno(),65536)
                    if not block:selector.unregister(key.fileobj);continue
                    destination=out if key.data=='stdout' else err;destination.write(block);destination.flush()
                    if key.data=='stdout':
                        buffers['stdout']+=block
                        while b'\n' in buffers['stdout']:
                            line,buffers['stdout']=buffers['stdout'].split(b'\n',1)
                            try:
                                event=json.loads(line)
                                if event.get('kind')=='identity' and event.get('role')!='runner-parent-observation-only':
                                    identity=(event['pid'],event['birthSeconds'],event['birthMicroseconds'])
                                    identities[identity]=event
                                    save(ROOT/'owned-identities.json',{'identities':list(identities.values())})
                            except Exception:pass
            code=probe.wait(timeout=1)
        execution['probe'].update({'returnCode':code,'actualExitCode':code if code>=0 else None,'signal':-code if code<0 else None,'endedMonotonic':time.monotonic()})
        save(ROOT/'execution.json',execution)
    except BaseException as exc:
        execution['errors'].append({'kind':type(exc).__name__,'message':str(exc)})
        if probe is not None and probe.poll() is None:
            forced=True;execution['probe']['terminationByRunner']=True;probe.terminate()
            try:probe.wait(timeout=1)
            except subprocess.TimeoutExpired:probe.kill();probe.wait(timeout=1)
        if probe is not None:
            code=probe.poll();execution['probe'].update({'returnCode':code,'actualExitCode':code if code is not None and code>=0 else None,'signal':-code if code is not None and code<0 else None})
    finally:
        # Source stdout remains raw; cleanup cannot swallow final execution/result persistence.
        save(ROOT/'execution.json',execution)
        cleanup={'kind':'actual-controlled-process-cleanup','knownIdentityCount':len(identities),'runnerForcedTermination':forced,'nativeHooksInstalled':False,'portsOpened':False,'AppOrPTYStarted':False,'checks':[],'errors':[]}
        try:
            if binary.is_file() and identities:
                own_list=ROOT/'owned-identities.tsv';own_list.write_text(''.join('%d %d %d\n'%key for key in sorted(identities)))
                for mode in ['--observe','--terminate']:
                    command=[str(binary),'--verify-list',str(own_list),mode]
                    child=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                    try:out,err=child.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        child.kill();out,err=child.communicate(timeout=1)
                    stem='cleanup-observe' if mode=='--observe' else 'cleanup-exact'
                    (ROOT/(stem+'.jsonl')).write_bytes(out);(ROOT/(stem+'.stderr.log')).write_bytes(err)
                    entry={'command':command,'pid':child.pid,'returnCode':child.returncode,'signal':-child.returncode if child.returncode<0 else None,'stdout':stem+'.jsonl'}
                    cleanup['checks'].append(entry);execution['auxiliary'].append(entry)
                    if mode=='--observe' and child.returncode==0:break
                final=cleanup['checks'][-1]
                rows=records(ROOT/final['stdout'])
                cleanup['exactOwnedIdentitiesClear']=final['returnCode']==0 and len(rows)==len(identities) and all(x.get('kind')=='verification' and not x.get('sameIdentityStillPresent',True) for x in rows)
            else:cleanup['exactOwnedIdentitiesClear']=not identities
        except BaseException as exc:cleanup['errors'].append({'kind':type(exc).__name__,'message':str(exc)})
        finally:
            save(ROOT/'cleanup.json',cleanup);save(ROOT/'execution.json',execution)
        # Independent pure-data judge. A judge exception preserves raw and produces an explicit error.
        try:
            judged=subprocess.run([sys.executable,str(ROOT/'judge.py')],cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=1)
            (ROOT/'judge.stdout.log').write_bytes(judged.stdout);(ROOT/'judge.stderr.log').write_bytes(judged.stderr)
            save(ROOT/'judge-exit.json',{'returnCode':judged.returncode})
        except BaseException as exc:save(ROOT/'judge-error.json',{'kind':type(exc).__name__,'message':str(exc)})
        files=[]
        for path in sorted(ROOT.rglob('*')):
            if path.is_file() and path.name not in ['manifest.json'] and 'cache' not in path.relative_to(ROOT).parts:
                files.append({'path':str(path.relative_to(ROOT)),'sha256':sha(path),'bytes':path.stat().st_size})
        save(ROOT/'manifest.json',{'files':files,'excludesSelfAndPrivateCache':True})
    print(json.dumps({'root':str(ROOT),'compiler':execution['compiler'].get('returnCode'),'probe':execution['probe'].get('returnCode'),'cleanup':str(ROOT/'cleanup.json'),'result':str(ROOT/'result.json')}))
    return 0 if not execution['errors'] else 1
if __name__=='__main__':raise SystemExit(main())
