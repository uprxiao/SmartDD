#!/usr/bin/env python3
"""Research probe of the existing stdio MCP, using synthetic context only."""
import argparse
import hashlib
import json
import platform
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    source = args.root / 'resources/runtime/context_mcp.py'
    public = {'projectId': 'synthetic-project-A', 'taskId': 'synthetic-task',
              'runId': 'synthetic-run', 'configVersion': 1,
              'name': 'Synthetic project', 'databases': [], 'servers': [], 'skills': []}

    def run(context, requests):
        with tempfile.TemporaryDirectory(prefix='m10-mcp-research-') as directory:
            file = Path(directory) / 'public-context.json'
            file.write_text(json.dumps(context), encoding='utf-8')
            result = subprocess.run([sys.executable, str(source), str(file)],
                                    input='\n'.join(requests) + '\n', text=True,
                                    capture_output=True, timeout=10, check=True)
            return [json.loads(line) for line in result.stdout.splitlines()]

    def request(identifier, method, params=None):
        return json.dumps({'jsonrpc': '2.0', 'id': identifier, 'method': method,
                           'params': params or {}})

    replies = run(public, [
        request(1, 'initialize', {'protocolVersion': '2024-11-05'}),
        json.dumps({'method': 'notifications/initialized'}),
        request(2, 'tools/list'),
        request(3, 'tools/call', {'name': 'project_context', 'arguments': {}}),
        request(4, 'tools/call', {'name': 'not-a-real-tool', 'arguments': {}}),
        '{malformed json',
        request(5, 'ping'),
        request(6, 'tools/call', {'name': 'project_context',
                                 'arguments': {'projectId': 'synthetic-project-B'}}),
    ])
    by_id = {item['id']: item for item in replies}
    context = json.loads(by_id[3]['result']['content'][0]['text'])
    foreign = json.loads(by_id[6]['result']['content'][0]['text'])
    early = run(public, [request(7, 'tools/call', {'name': 'project_context'})])[0]
    unsupported = run(public, [request(8, 'initialize',
                                     {'protocolVersion': 'synthetic-unsupported-version'})])[0]
    synthetic_private = {**public, 'synthetic_private_canary': 'SYNTHETIC-NO-REAL-SECRET'}
    projection_probe = run(synthetic_private, [request(9, 'tools/call',
                                                     {'name': 'project_context'})])[0]
    checks = [
        ('MCP-01', 'initialize returns server metadata',
         by_id[1]['result']['serverInfo']['name'] == 'smartdd-project', 'verified'),
        ('MCP-02', 'tool discovery exposes only current read-only context',
         [t['name'] for t in by_id[2]['result']['tools']] == ['project_context'], 'verified'),
        ('MCP-03', 'tool output equals synthetic public projection', context == public, 'verified'),
        ('MCP-04', 'unknown tool rejected', by_id[4]['error']['code'] == -32601, 'verified'),
        ('MCP-05', 'malformed JSON gets parse error and following ping survives',
         by_id[None]['error']['code'] == -32700 and by_id[5]['result'] == {}, 'verified'),
        ('MCP-06', 'caller cannot select a different project through arguments',
         foreign['projectId'] == 'synthetic-project-A', 'verified'),
        ('MCP-07', 'pre-initialize call currently accepted; no handshake gate',
         'result' in early, 'observed_limitation'),
        ('MCP-08', 'unsupported version currently echoed; no negotiation validation',
         unsupported['result']['protocolVersion'] == 'synthetic-unsupported-version',
         'observed_limitation'),
        ('MCP-09', 'source context is reflected wholesale; public projection must stay explicit',
         'synthetic_private_canary' in projection_probe['result']['content'][0]['text'],
         'observed_limitation'),
    ]
    report = {
        'schema': 'm10-existing-mcp-research-v1',
        'time': datetime.now(timezone.utc).isoformat(),
        'environment': {'platform': platform.platform(), 'python': sys.version.split()[0]},
        'source': {'path': str(source), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()},
        'fixture': 'synthetic-only; no real project database, account, mail or external request',
        'checks': [{'id': i, 'observation': title, 'assertion_met': bool(ok),
                    'classification': classification} for i, title, ok, classification in checks],
        'scope': 'existing context_mcp.py subprocess protocol only; no real CLI or model call',
        'interpretation': 'Observed limitations are research findings, not M10 acceptance results.'
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'checks': len(checks), 'assertions_met': sum(bool(x[2]) for x in checks),
                      'limitations_observed': sum(x[3] == 'observed_limitation' for x in checks)}))
    return 0 if all(x[2] for x in checks) else 1


if __name__ == '__main__':
    raise SystemExit(main())
