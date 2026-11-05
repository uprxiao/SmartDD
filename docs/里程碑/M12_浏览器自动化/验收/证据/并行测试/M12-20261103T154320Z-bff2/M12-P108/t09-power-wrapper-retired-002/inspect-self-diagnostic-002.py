"""One exact own-process read, no child business/App/power/network; requires fresh Root lease."""
from pathlib import Path
import importlib.util,json,os,sys,hashlib
ROOT=Path('/private/tmp/willyou-m12-t09-cm-power-wrapper-002')
assert os.environ.get('WILLYOU_M12_NATIVE_LEASE_CONFIRMED')=='1'
assert hashlib.sha256((ROOT/'run.py').read_bytes()).hexdigest()=='6175c659ca790c1847a5d7aab7c3821eb4aae8ec1374094b7b76addb6b7590df'
spec=importlib.util.spec_from_file_location('frozen_wrapper002',ROOT/'run.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
row=m.ps_one(os.getpid())
checks={'rowPresent':bool(row),'UIDMatches':bool(row and row['uid']==os.getuid()),'kernelExePresent':bool(row and row.get('executable')),'kernelExeMatchesInterpreter':bool(row and row.get('executable') and Path(row['executable']).resolve()==Path(sys.executable).resolve()),'argvScriptTailMatches':bool(row and row['argv'][-1:]==[str(ROOT/'inspect-self-diagnostic-002.py')])}
out={'at':m.utc(),'source':'actual current Python PS + kernel libproc proc_pidpath','identity':row,'sysExecutable':sys.executable,'resolvedInterpreter':str(Path(sys.executable).resolve()),'expectedScript':str(ROOT/'inspect-self-diagnostic-002.py'),'checks':checks,'commUsedForIdentity':False,'App':0,'CM':0,'network':0,'PTY':0,'powerAssertions':0,'formalCaseIncrement':0}
m.save('self-format-observation-002.json',out)
print(json.dumps({'pid':os.getpid(),'checks':checks,'commDescription':row.get('comm') if row else None,'kernelExecutable':row.get('executable') if row else None,'sysExecutable':sys.executable,'App':0,'powerAssertions':0}))
sys.exit(0 if all(checks.values()) else 1)
