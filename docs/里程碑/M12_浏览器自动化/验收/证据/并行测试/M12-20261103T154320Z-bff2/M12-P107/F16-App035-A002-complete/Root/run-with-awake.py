from pathlib import Path
import datetime, hashlib, json, os, subprocess, time

root = Path('/private/tmp/willyou-m12-t130-F16-App035-A-cont-002')
receipt = Path(__file__).parent
ready = root/'READY.json'
assert ready.exists() and not (root/'runtime-001').exists()
assert not (receipt/'actual-started.json').exists()
env = dict(os.environ, WILLYOU_M12_NATIVE_LEASE_CONFIRMED='1', WILLYOU_TEST_CACHE_DIR=str(root/'cache'), NODE_COMPILE_CACHE=str(root/'cache/node'))
cmd = ['/Users/liubu/.hermes/node/bin/node', str(root/'run.mjs'), '--execute']
awake = subprocess.Popen(['/usr/bin/caffeinate', '-di', '-t', '1200'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
driver = None
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
try:
    with (receipt/'actual-driver.stdout.private.log').open('w') as out, (receipt/'actual-driver.stderr.private.log').open('w') as err:
        driver = subprocess.Popen(cmd, cwd=root, env=env, stdout=out, stderr=err)
        value = {'at': started, 'wrapperPid': os.getpid(), 'driverPid': driver.pid, 'awakePid': awake.pid, 'command': cmd, 'readySHA256': hashlib.sha256(ready.read_bytes()).hexdigest(), 'noGlobalPowerSettingsChanged': True}
        (receipt/'actual-started.json').write_text(json.dumps(value,indent=2)+'\n')
        print(json.dumps({'stage':'actual-F16-started','driverPid':driver.pid,'awakePid':awake.pid}), flush=True)
        code = driver.wait()
finally:
    if awake.poll() is None:
        awake.terminate()
    awake_code = awake.wait(timeout=10)
    result = {'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wrapperPid':os.getpid(),'driverPid':driver.pid if driver else None,'exitCode':driver.returncode if driver else None,'awakePid':awake.pid,'awakeExitCode':awake_code,'awakeReaped':True,'scope':'Only bounded own idle-prevention helper; no unlock/input/system setting change. Actual App normal exit is separately recorded.'}
    (receipt/'actual-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)
assert code == 0, 'Preserve actual driver failure and inspect original raw before any retry'
