#!/usr/bin/env python3
"""Extract replay inputs from the reviewer's actual recordings, without credentials.

Keep event shape/order/IDs and synthetic task payloads. Drop discovery inventories,
machine/account metadata and unneeded fields. Original bytes remain untouched.
"""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).resolve()
dest = Path(__file__).parent / 'fixtures'
dest.mkdir(exist_ok=True)
manifest = []
secret = re.compile(r'^(authorization|auth_token|api_key|apiKey|access_token|refresh_token|signature)$', re.I)
def clean(x):
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items() if not secret.match(k)}
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, str):
        x = x.replace(str(source.parent), '<review-scratch>')
        x = re.sub(r'/Users/[^/\s]+', '/Users/review-user', x)
        # Credentials never belong to a synthetic replay task.
        if re.search(r'(?i)(?:Bearer\s+[A-Za-z0-9_.-]{12,}|sk-[A-Za-z0-9_-]{16,})', x):
            raise ValueError('Unexpected credential-shaped value; inspect privately')
    return x

param_keys = {'threadId', 'turnId', 'itemId', 'delta', 'item', 'turn', 'tokenUsage',
              'message', 'summary', 'run', 'error', 'rateLimits', 'requestId', 'command',
              'cwd', 'reason', 'approvalId', 'permissions', 'additionalPermissions',
              'networkApprovalContext', 'availableDecisions', 'questions', 'elicitation'}
claude_keys = {'actor', 'driver', 't', 'type', 'subtype', 'session_id', 'uuid', 'message',
               'parent_tool_use_id', 'result', 'is_error', 'usage', 'duration_ms', 'num_turns',
               'model', 'permissionMode', 'claude_code_version', 'tool_use_id', 'event',
               'estimated_tokens', 'stop_reason', 'terminal_reason', 'api_error_status'}
for run in ['v03-a', 'v01-b', 'v02-a', 'v07-R5', 'v07-R6', 'v07-R7', 'v08-a', 'v08-b', 'v06-a']:
    f = source / run / 'native.jsonl'
    rows = []
    for number, line in enumerate(f.read_text().splitlines(), 1):
        e = json.loads(line)
        if e.get('driver') == 'codex':
            out = {k: e[k] for k in ['actor', 'driver', 't', 'id', 'method'] if k in e}
            p = e.get('params', {})
            out['params'] = {k: v for k, v in p.items() if k in param_keys}
            if 'thread' in p:
                out['params']['thread'] = {k: v for k, v in p['thread'].items() if k in ['id', 'status']}
        elif e.get('driver') == 'claude':
            out = {k: v for k, v in e.items() if k in claude_keys}
        else:  # ACP: no MCP argv (contains the old one-time bridge ticket) or user inventory.
            out = {k: v for k, v in e.items() if k in ['actor', 'driver', 't', 'method', 'type', 'dir', 'id']}
            p = e.get('params', {})
            out['params'] = {k: p[k] for k in ['sessionId', 'prompt', 'options'] if k in p}
            if 'update' in p:
                u = p['update']
                out['params']['update'] = {k: v for k, v in u.items() if k not in ['availableCommands', 'configOptions']}
                out['params']['update']['advertisedOptionCount'] = len(u.get('availableCommands', u.get('configOptions', [])))
            if 'result' in e:
                out['result'] = {k: v for k, v in e['result'].items() if k in ['sessionId', 'stopReason', 'protocolVersion']}
        if 'turn' in out.get('params', {}):
            out['params']['turn'] = {k: v for k, v in out['params']['turn'].items() if k in ['id', 'status', 'error']}
        out['recordingLine'] = number
        rows.append(clean(out))
    target = dest / (run + '.jsonl.gz')
    payload = ''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows).encode()
    target.write_bytes(gzip.compress(payload, mtime=0))
    manifest.append({'run': run, 'source': str(f), 'sourceSha256': hashlib.sha256(f.read_bytes()).hexdigest(),
                     'fixture': target.name, 'fixtureSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                     'events': len(rows), 'evidence': 'real-model recording; sanitized replay, not a new live run'})
    host = source / run / 'host.jsonl'
    if host.exists():
        h = [clean(json.loads(l)) for l in host.read_text().splitlines() if l]
        hf = dest / (run + '-host.jsonl.gz')
        hf.write_bytes(gzip.compress((''.join(json.dumps(x) + '\n' for x in h)).encode(), mtime=0))
        manifest[-1]['host'] = {'fixture': hf.name, 'sourceSha256': hashlib.sha256(host.read_bytes()).hexdigest(),
                                'fixtureSha256': hashlib.sha256(hf.read_bytes()).hexdigest()}
    result = source / run / 'result.json'
    if result.exists():
        r = json.loads(result.read_text())
        # Preserve original failed steps, including maxTurns; never turn partial results green.
        (dest / (run + '-result.json')).write_text(json.dumps(clean(r), ensure_ascii=False, indent=2) + '\n')

approval = {'source': 'v08-a', 'evidence': 'recording + retained probe filesystem; no new model call', 'cases': {}}
for label in ['accept', 'decline', 'inherit']:
    root = source / 'v08-a'
    req = root / ('codex-' + label + '-request.json')
    file = root / ('codex-' + label) / ('inherit-probe.txt' if label == 'inherit' else 'approval-probe.txt')
    native = [json.loads(l) for l in (root / 'native.jsonl').read_text().splitlines() if l]
    requests = [e for e in native if e.get('actor') == 'codex-' + label and 'id' in e and e.get('method')]
    approval['cases'][label] = {'requestCount': len(requests), 'fileExists': file.exists(),
                               'requestFile': clean(json.loads(req.read_text())) if req.exists() else None}
(dest / 'approval-evidence.json').write_text(json.dumps(approval, ensure_ascii=False, indent=2) + '\n')
(dest / 'recordings-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'recordings': len(manifest), 'events': sum(m['events'] for m in manifest)}, ensure_ascii=False))
