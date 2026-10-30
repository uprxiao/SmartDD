#!/usr/bin/env python3
"""Read retained results; no new Agent/model calls and no credential values output."""
import hashlib
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re

SELF = Path(__file__).resolve()
BASE = SELF.parent
ROOT = SELF.parents[7]
ART = ROOT / 'release/m10-research/runtime-preflight-20261019/claude-user-config'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def read(name):
    return json.loads((BASE / (name + '-result.json')).read_text())


def commands(d):
    return {c['name']: c['descriptionHash'] for c in d['commands']}


def mcp(d):
    return {s['name']: {'source': s['source'], 'toolNames': s['toolNames']} for s in d['mcpServers']}


def main():
    baseline, injected, conflict, new, resumed = [read(n) for n in ['baseline', 'inventory', 'collision', 'real-new', 'real-resume']]
    runs = [injected, conflict, new, resumed, baseline]
    plain, enhanced = commands(baseline), commands(injected)
    plain_entries = Counter((c['name'], c['descriptionHash']) for c in baseline['commands'])
    enhanced_entries = Counter((c['name'], c['descriptionHash']) for c in injected['commands'])
    cm = conflict['collision']['mcpServerName']
    cs = conflict['collision']['skillFullName']
    namespace = cs.split(':')[0] + ':'
    native = Path(resumed['nativeSessionFile'])
    records = [json.loads(line) for line in native.read_text().splitlines()]
    tool_checks = []
    for d in [new, resumed]:
        raw = ROOT / next(x['path'] for x in d['rawArtifacts'] if x['path'].endswith('.jsonl') and not x['path'].endswith('-calls.jsonl'))
        events = [json.loads(line) for line in raw.read_text().splitlines()]
        uses = [c for e in events for c in e.get('message', {}).get('content', []) if isinstance(c, dict) and c.get('type') == 'tool_use']
        expected = str(ART / 'packages/1.0.0/plugin/skills/version-check/references/check.json')
        tool_checks.append({'mode': d['mode'], 'exactSkill': [u.get('input', {}).get('skill') for u in uses if u.get('name') == 'Skill'] == ['wy-native-preflight:version-check'],
            'onlyExactReference': [u.get('input', {}).get('file_path') for u in uses if u.get('name') == 'Read'] == [expected],
            'onlySyntheticMcp': [u['name'] for u in uses if u['name'].startswith('mcp__')] == ['mcp__wy_native_preflight__version_check'],
            'noOtherTools': all(u['name'] in ['Skill', 'Read', 'mcp__wy_native_preflight__version_check'] for u in uses)})
    source_hashes = {sha(BASE / n): n for n in ['probe-initial.py', 'probe.py']}
    first = injected['configBefore']
    final = baseline['configAfter']
    preserved = {}
    for p, before in first.items():
        after = final[p]
        changes = sorted(k for k in set(before['topLevelValueHashes']) | set(after['topLevelValueHashes']) if before['topLevelValueHashes'].get(k) != after['topLevelValueHashes'].get(k))
        preserved[p] = {'bytesUnchanged': before['sha256'] == after['sha256'], 'changedTopLevelKeys': changes,
            'allNonRuntimeValuesUnchanged': all(k in ['pluginUsage', 'skillUsage'] for k in changes)}
    # Scan known credential VALUES only in the newly generated evidence; do not output values or arbitrary matches.
    spec = importlib.util.spec_from_file_location('profile', BASE.parent / 'claude/probe.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    env = {}
    module.apply_cdsh(env)
    secrets = [v.encode() for k, v in env.items() if re.search(r'TOKEN|KEY|SECRET|PASSWORD', k) and len(v) >= 8]
    hits = []
    scanned = 0
    for root in [BASE, ART]:
        for p in root.rglob('*'):
            if p.is_file():
                if root == ART:
                    p.chmod(0o600)
                scanned += 1
                data = p.read_bytes()
                if any(value in data for value in secrets):
                    hits.append(str(p.relative_to(ROOT)))
    assertions = {
        'realDefaultNativeRootUsed': all(d['HOME'] == '/Users/liubu' and d['CLAUDE_CONFIG_DIR'] is None and d['nativeRoot'] == '/Users/liubu/.claude' for d in runs),
        'normalSourcesAndNoStrictMcp': all(d['normalSettingSources'] and not d['strictMcpConfig'] for d in runs),
        'all189BaselineCommandsPreservedWithIdenticalMetadata': len(baseline['commands']) == 189 and not (plain_entries - enhanced_entries),
        'managedSkillIsOnlyAddedCommand': sorted(set(enhanced) - set(plain)) == ['wy-native-preflight:version-check'],
        'sixUserMcpDefinitionsAndToolListsPreserved': len(mcp(baseline)) == 6 and all(mcp(injected).get(k) == v for k, v in mcp(baseline).items()),
        'managedMcpConnected': any(s['name'] == 'wy_native_preflight' and s['status'] == 'connected' for s in injected['mcpServers']),
        'exactPluginCollisionReplacesOriginalEntry': next(c for c in conflict['commands'] if c['name'] == cs)['syntheticCollisionMarker'] and commands(conflict)[cs] != plain[cs],
        'exactPluginCollisionDropsSevenSiblingCommands': len([n for n in plain if n.startswith(namespace) and n not in commands(conflict)]) == 7,
        'exactMcpCollisionReplacesOriginalUserToolList': mcp(conflict)[cm] == {'source': 'dynamic', 'toolNames': ['version_check']} and mcp(baseline)[cm]['source'] == 'user',
        'noCollisionToolCalled': all((ROOT / a['path']).read_text() == '' for a in conflict['rawArtifacts'] if a['path'].endswith('-calls.jsonl')),
        'realNewAndNativeResumeSucceeded': new['passed'] and resumed['passed'] and new['actualSessionId'] == resumed['actualSessionId'],
        'bothTurnsUsedExactFixtureOnly': all(all(v for k, v in t.items() if k != 'mode') for t in tool_checks),
        'ownNativeHistoryPersisted': native.exists() and any(r.get('sessionId') == new['actualSessionId'] for r in records),
        'settingsBytesAndConfigDefinitionsPreserved': all(x['allNonRuntimeValuesUnchanged'] for x in preserved.values()) and all(x['bytesUnchanged'] for p, x in preserved.items() if p.endswith('/settings.json') or p.endswith('/settings.local.json')),
        'runSourceHashesResolvable': all(d['scriptSha256'] in source_hashes for d in runs),
        'rawEvidenceHashesMatch': all(sha(ROOT / x['path']) == x['sha256'] for d in runs for x in d['rawArtifacts']),
        'allProbeChildrenExited': all(d['childExited'] for d in runs),
        'noKnownCdshCredentialValueInEvidence': not hits,
    }
    result = {'schema': 'm10-cc-real-user-config-summary-v1', 'status': 'passed-with-boundaries' if all(assertions.values()) else 'has-failures',
        'assertions': assertions, 'assertionCount': len(assertions), 'sourceArtifactsByHash': source_hashes,
        'environment': {'cli': new['cliVersion'], 'binarySha256': new['binarySha256'], 'profile': 'cdsh', 'model': new['model'], 'nativeRoot': new['nativeRoot'], 'HOME': new['HOME'], 'CLAUDE_CONFIG_DIR': None},
        'runs': [{'mode': d['mode'], 'startedAt': d['startedAt'], 'endedAt': d['endedAt'], 'commandCount': len(d['commands']), 'report': d['mode'] + '-result.json'} for d in runs],
        'existingDuplicateCommandNames': {k: n for k, n in Counter(c['name'] for c in baseline['commands']).items() if n > 1},
        'collisionEvidence': {'plugin': {'namespace': namespace[:-1], 'replacedCommand': cs, 'lostSiblingCommands': sorted(n for n in plain if n.startswith(namespace) and n not in commands(conflict))},
            'mcp': {'serverName': cm, 'original': mcp(baseline)[cm], 'collision': mcp(conflict)[cm]}},
        'configPreservation': preserved, 'nativeSession': {'sessionId': new['actualSessionId'], 'file': str(native), 'sha256': sha(native), 'records': len(records), 'userDailyHistoryResumed': False},
        'exactToolChecks': tool_checks, 'credentialScan': {'scannedFileCount': scanned, 'knownCredentialValueMatchFiles': hits, 'valuesNeverOutput': True},
        'scope': {'realUserConfiguration': True, 'realNativeDefaultRoot': True, 'realModelTurns': 2, 'injectedPackagesAndTool': 'synthetic', 'userMcpToolsInvoked': False, 'hooksDisabled': True, 'TUI': False, 'packagedWillYou': False},
        'remainingBoundaries': ['Only CC 2.1.303 with the authorized cdsh/deepseek-flash profile on this macOS arm64 machine.', 'playwright retained as pending within the bounded discovery window in baseline and injected cases; no claim that all user MCP services are healthy.', 'Global settings/profile were real; project cwd was a new synthetic directory and daily historical conversations were not resumed.', 'Hooks disabled for probe safety; hook behavior, interactive TUI and final WillYou launcher/broker/upgrade remain implementation/acceptance work.', 'Same-name collisions are observed unsafe native precedence; the required fail-closed application injection guard is a design contract, not implemented production behavior.']}
    (BASE / 'result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'status': result['status'], 'assertions': assertions, 'report': str(BASE / 'result.json')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
