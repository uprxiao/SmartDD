#!/usr/bin/env python3
"""Hash and index existing preflight evidence. No CLI, model or business calls."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
MILESTONE = BASE.parents[2]
ROOT = MILESTONE.parents[2]
OUT = MILESTONE / '验收/证据/m10-runtime-preflight-20261019.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


reports = []
for relative in ['claude/result.json', 'codex/result.json', 'codex/real-model-result.json',
                 'packaged-bridge/result.json', 'mixed-discovery/result.json',
                 'mixed-discovery/real-mixed-result.json']:
    path = BASE / relative
    result = json.loads(path.read_text())
    reports.append({'path': str(path.relative_to(ROOT)), 'sha256': sha(path),
                    'status': result.get('status', result.get('passed'))})
claude = json.loads((BASE / 'claude/result.json').read_text())
mixed = json.loads((BASE / 'mixed-discovery/result.json').read_text())
real_mixed = json.loads((BASE / 'mixed-discovery/real-mixed-result.json').read_text())
assert all(case['verifiedPassed'] for case in claude['cases'])
assert all(mixed['assertions'].values())
assert all(case['status'] == 'passed' for case in real_mixed['cases'])
files = sorted(p for p in BASE.rglob('*') if p.is_file() and p.suffix in ['.md', '.json', '.py', '.mjs', '.cjs'])
result = {
    'schema': 'm10-preflight-evidence-index-v1',
    'collectedAt': datetime.now(timezone.utc).isoformat(),
    'requirements': 'R1.6-20261019 / 12.20 A19',
    'status': 'mechanism-evidence-archived-with-boundaries',
    'scope': 'Existing CLI/model/packaged-runtime experiments; no production acceptance inferred.',
    'reports': reports,
    'summary': {
        'claudeRealCasesVerified': len(claude['cases']),
        'claudeOriginalNativeIdentityResumed': claude['resumeSameNativeIdentity'],
        'claudeConcurrentInvocationOverlapSeconds': claude['processInvocationOverlapSeconds'],
        'mixedDiscoveryAssertionsPassed': sum(mixed['assertions'].values()),
        'mixedRealTurnsPassed': len(real_mixed['cases']),
        'mixedChildrenExited': real_mixed['cleanup']['allChildrenExited'],
        'mixedTemporaryRootRemoved': real_mixed['cleanup']['temporaryRootRemoved'],
        'originalConfigurationFilesUnchanged': all(c['unchanged'] for c in claude['configurationChecks']),
        'productCaseCountUnchanged': 72,
    },
    'negativeResultsPreserved': [
        'Codex directory path fails version filtering despite accepted syntax.',
        'Codex thread without a turn has no resumable rollout.',
        'Codex first concurrent empty-root initialization failed once; later initialized-root runs succeeded.',
        'Accurate MCP annotations needed for tested model approval path; direct RPC success was insufficient.',
        'Claude initial missing auth/network EPERM/default-provider 402 attempts remain failures.',
        'Claude empty setting sources omitted synthetic user Skill; normal-source mixed probe passed separately.',
        'Mixed harness response-envelope/MCP-pending attempts are retained separately.',
    ],
    'unproven': [
        'Actual user default roots/profile/name conflicts and all installed user plugins/MCP combinations.',
        'Terminal TUI and packaged WillYou production launch/broker/permissions.',
        'Actual app installation/upgrades/catalog mutations/GC/database migration and business recovery.',
        'Other CLI versions, agents, platforms, or full M10 product acceptance.',
    ],
    'files': [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for p in files],
}
OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'files': len(files), 'reports': len(reports)}))
