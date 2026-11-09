"""Verify only exact resources recorded by this F16 run; never kill or delete."""
from pathlib import Path
import datetime, hashlib, json, os, re, subprocess, sys

root = Path(sys.argv[1]).resolve()
assert root == Path('/private/tmp/willyou-m12-t130-F21-App035-A-prep-001')
raw = json.loads((root/'raw.json').read_text())
target = root/'cleanup.json'
assert not target.exists(), 'Keep previous cleanup; use a fresh receipt for a repeated audit'
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'Read-only exact self-owned F16 recorded PID/TCP/Unix resources; no kill/delete and no daily data', 'rawSHA256': hashlib.sha256((root/'raw.json').read_bytes()).hexdigest(), 'processes': [], 'ports': [], 'unix': [], 'helpers': []}

def command(args):
    r = subprocess.run(args, capture_output=True, text=True, timeout=8)
    return {'status': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr, 'absent': r.returncode == 1 and not r.stdout.strip() and not r.stderr.strip()}

for pid in sorted(set(raw['knownPids'])):
    assert isinstance(pid, int) and pid > 1 and pid != os.getpid()
    result['processes'].append({'pid': pid, **command(['/bin/ps','-p',str(pid),'-o','pid='])})
for port in sorted(set(raw['knownPorts'])):
    assert isinstance(port, int) and 1024 <= port <= 65535
    result['ports'].append({'port': port, **command(['/usr/sbin/lsof','-nP','-t','-iTCP:'+str(port),'-sTCP:LISTEN'])})
for value in sorted(set(raw['exactGatewayPaths'])):
    assert re.fullmatch(r'/(?:private/)?tmp/wy-(?:cli-)?[0-9]+-[A-Za-z0-9_-]+/(?:broker|cli)\.sock', value), value
    p = Path(value)
    result['unix'].append({'path': value, 'socketAbsent': not p.exists() and not p.is_symlink(), 'parentAbsent': not p.parent.exists()})
result['allClear'] = bool(result['processes']) and all(r['absent'] for r in result['processes']+result['ports']) and all(r['socketAbsent'] and r['parentAbsent'] for r in result['unix'])
result['originalNormalExit'] = [{'kind': m['kind'], 'appExit': m.get('appExit'), 'observedProcess': m.get('observedProcess')} for m in raw['modes']]
target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'allClear':result['allClear'],'processes':len(result['processes']),'ports':len(result['ports']),'unix':len(result['unix'])}))
assert result['allClear'], 'Recorded resource remains or read-only audit was inconclusive; do not kill unknown processes'
