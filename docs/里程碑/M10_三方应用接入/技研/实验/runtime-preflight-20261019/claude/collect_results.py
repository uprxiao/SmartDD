#!/usr/bin/env python3
"""Collect allowlisted synthetic evidence; never read or publish auth values."""
from datetime import datetime
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[6]
PRIVATE = ROOT / 'release/m10-research/runtime-preflight-20261019'
ART = PRIVATE / 'claude'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


cases = []
identities = {}
for name in ['old-new-cdsh', 'old-resume-cdsh', 'new-new-cdsh']:
    source = ART / (name + '-result.json')
    report = read(source)
    events = []
    for line in (ART / (name + '.jsonl')).read_text().splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    init = next(e for e in events if e.get('type') == 'system' and e.get('subtype') == 'init')
    uses = [c for e in events for c in e.get('message', {}).get('content', [])
            if isinstance(c, dict) and c.get('type') == 'tool_use']
    reference = ART / 'packages' / report['expectedVersion'] / 'plugin/skills/version-check/references/check.json'
    report['exactReferenceRead'] = any(c.get('name') == 'Read' and c.get('input', {}).get('file_path') == str(reference)
                                       for c in uses)
    report['exactVersionReturned'] = all(c['version'] == report['expectedVersion'] for c in report['mcpCalls'])
    report['verifiedPassed'] = (report['passed'] and report['skillToolUsed'] and report['exactReferenceRead']
                                 and report['exactVersionReturned'] and len(report['mcpCalls']) == 1)
    report['nativeSessionId'] = init['session_id']
    report['modelObservedAtInit'] = init.get('model')
    report['privateEvidenceHashes'] = {
        str(p.relative_to(PRIVATE)): digest(p) for p in [source, ART / (name + '.jsonl'), ART / (name + '-tools.jsonl')]
    }
    if 'probeSha256' not in report:
        report['sourceHashCaptureBoundary'] = 'Initial v1 success preceded timestamp/hash reporting; no contemporaneous source hash was captured.'
    identities[name] = init['session_id']
    cases.append(report)

resume, new = cases[1:]
overlap = (min(datetime.fromisoformat(resume['endedAt']), datetime.fromisoformat(new['endedAt']))
           - max(datetime.fromisoformat(resume['startedAt']), datetime.fromisoformat(new['startedAt']))).total_seconds()
baseline = read(PRIVATE / 'baseline.json')
config_checks = [{'path': path, 'unchanged': Path(path).exists() and digest(Path(path)) == expected}
                 for path, expected in baseline['configHashes'].items()]
attempts = []
for rel, reason in [('initial-noauth/old-new-result.json', 'REA process did not inherit shell authentication'),
                    ('initial-network-denied/old-new-result.json', 'Sandbox network EPERM'),
                    ('old-new-result.json', 'Existing default provider returned 402 subscription quota exhausted')]:
    p = ART / rel
    report = read(p)
    attempts.append({'path': str(p.relative_to(PRIVATE)), 'sha256': digest(p), 'passed': report['passed'],
                     'reason': reason, 'resultSubtype': report.get('resultSubtype')})
binary = Path('/Users/liubu/.local/bin/claude').resolve()
result = {
    'schema': 'm10-claude-preflight-v1', 'date': '2026-10-19',
    'scope': 'E-CLI-PROBE; real CLI/model with synthetic plugin and MCP; isolated native state',
    'status': 'passed-with-boundaries', 'cliVersion': '2.1.303', 'profile': 'cdsh',
    'requestedModelDescription': 'User described DeepSeek 4.1 Flash; observed configured identifier is deepseek-flash',
    'executable': str(binary), 'executableSha256': digest(binary),
    'probeSha256AtCollection': digest(HERE / 'probe.py'), 'cases': cases,
    'resumeSameNativeIdentity': identities['old-new-cdsh'] == identities['old-resume-cdsh'],
    'newSessionHasSeparateIdentity': identities['old-new-cdsh'] != identities['new-new-cdsh'],
    'processInvocationOverlapSeconds': overlap, 'configurationChecks': config_checks,
    'failedAttempts': attempts,
    'negativeObservation': 'Synthetic user Skill in isolated CLAUDE_CONFIG_DIR was absent under --setting-sources empty. This configuration cannot establish user-capability preservation.',
    'limitations': [
        'Both package versions existed before the first tested process; no actual installation/upgrade/GC was exercised.',
        'Explicit Skill request, isolated CLAUDE_CONFIG_DIR, empty setting sources, strict MCP list. Not production merge semantics.',
        'HOME value remained unchanged; that does not prove normal global capability discovery.',
        'Only synthetic short native sessions; no user history, TUI, production broker, business data or SMTP.',
        'CLI sessions preserve original IDs, but fixed version is supplied again by the launcher; resume alone does not lock a package.',
        'Probe driver exits 0 after writing a report even for failed attempts; verdict uses verifiedPassed, not wrapper exit code.',
    ]
}
assert all(c['verifiedPassed'] for c in cases)
assert result['resumeSameNativeIdentity'] and result['newSessionHasSeparateIdentity'] and overlap > 0
assert all(c['unchanged'] for c in config_checks)
(HERE / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'cases': len(cases), 'overlapSeconds': overlap,
                  'resumeSameNativeIdentity': result['resumeSameNativeIdentity'],
                  'configurationUnchanged': all(c['unchanged'] for c in config_checks)}))
