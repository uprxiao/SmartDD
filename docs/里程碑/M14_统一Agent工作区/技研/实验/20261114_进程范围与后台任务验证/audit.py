from pathlib import Path
import subprocess, json, hashlib
base = Path(__file__).resolve().parent
observed, groups = set(), set()
for attempt in ['attempt-1', 'attempt-2']:
    for row in json.loads((base / attempt / 'result.json').read_text())['rows']:
        for t in row['trace']:
            if t['event'] in ['registered-before-execution', 'SDK-registered-before-release']:
                groups.add(t['pid'])
            if t['event'] == 'live-before-host-crash':
                groups.add(t['root'])
                observed.update([t['host'], t['root'], t['writer']])
            for k in ['pid', 'writer', 'host']:
                if isinstance(t.get(k), int): observed.add(t[k])
            if isinstance(t.get('identity'), dict) and t['identity'].get('pid'):
                observed.add(t['identity']['pid'])
helper = '/private/tmp/willyou-m14-owner-probe/process-identity'
identities = {str(pid): json.loads(subprocess.check_output([helper, str(pid)], text=True)) for pid in sorted(observed)}
rows = []
for line in subprocess.check_output(['ps', '-A', '-o', 'pid=,ppid=,pgid='], text=True).splitlines():
    bits = line.split()
    if len(bits) == 3 and int(bits[2]) in groups:
        rows.append(dict(zip(['pid', 'ppid', 'pgid'], map(int, bits))))
assert all(x['state'] == 'stopped' for x in identities.values()), identities
assert not rows, rows
(base / 'cleanup.json').write_text(json.dumps({'explicitObservedPids': identities, 'capturedGroupIds': sorted(groups), 'remainingGroupMembers': rows, 'method': 'Read-only kernel helper for recorded probe PIDs; ps only filters captured group IDs; no PID-name killing.'}, indent=2) + '\n')
src = json.loads((base / 'source-evidence.json').read_text())
src['t3Commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd='/Users/hx/projects/t3code', text=True).strip()
src['smartddCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd='/Users/hx/projects/SmartDD', text=True).strip()
for p in [Path('/Users/hx/projects/t3code/packages/shared/src/AgentScope.ts'), Path('/Users/hx/projects/SmartDD/native/applications/process-identity.cc'), Path('/private/tmp/willyou-m14-global-f3zh527k/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts')]:
    src['sources'].append({'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'use': 'read-only reference or existing compiled identity helper'})
(base / 'source-evidence.json').write_text(json.dumps(src, indent=2) + '\n')
print('All recorded process identities stopped; no members remain in recorded groups.')
