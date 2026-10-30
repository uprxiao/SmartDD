#!/usr/bin/env python3
"""Validate R1.6 documentation only; never launch agents or touch application data."""
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[5]
BASE = ROOT / 'docs/里程碑/M10_三方应用接入'
OUT = BASE / '验收/证据/m10-runtime-design-r16-20261019.json'
DOCS = [
    BASE / p for p in [
        'README.md', '需求.md', '交付说明.md', '原型/原型说明与变更.md',
        '技研/技术方案.md', '技研/应用包与Agent运行时详细设计R1.6.md',
        '技研/多Agent路径与扩展架构说明R1.6.md',
        '调研/调研总览V2.md', '调研/业务待决与后续验证V2.md',
        '调研/整体设计问题清单_R1.6_20261019.md',
        '调研/开工收口与准入结论_20261019.md',
        '调研/Codex与ChatGPT连接切换REA_20261019.md',
        '验收/测试用例.md', '验收/需求原型用例映射V2.md', '验收/执行与缺陷记录.md'
    ]
] + [ROOT / 'docs/需求池.md', ROOT / 'docs/里程碑/README.md']
DOCS += sorted((BASE / '技研/实验/runtime-preflight-20261019').rglob('*.md'))
SOURCES = [ROOT / p for p in [
    'src/main/app/identity.ts', 'src/main/index.ts', 'src/main/secrets.ts',
    'src/main/core/capabilities/assets.ts', 'src/main/core/capabilities/capability-service.ts',
    'src/main/core/capabilities/files.ts', 'src/main/core/tasks/task-service.ts',
    'src/main/core/capabilities/discovery.ts',
    'src/main/core/tasks/native-sessions.ts', 'src/main/db/schema.ts',
    'src/main/db/migrations.ts', 'resources/runtime/context_mcp.py',
    'electron-builder.config.cjs'
]]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(*args):
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=True, check=False)


def main():
    failures = []
    link_count = 0
    for path in DOCS:
        content = path.read_text()
        if len(re.findall(r'^```', content, re.M)) % 2:
            failures.append(f'unbalanced code fences: {path.relative_to(ROOT)}')
        for target in re.findall(r'\]\(([^)]+)\)', content):
            target = target.strip().strip('<>')
            if re.match(r'^[a-zA-Z][\w+.-]*:', target) or target.startswith('#'):
                continue
            target = unquote(target.split('#', 1)[0])
            if not target:
                continue
            resolved = (path.parent / target).resolve()
            link_count += 1
            if resolved != OUT and not resolved.exists():
                failures.append(f'missing link: {path.relative_to(ROOT)} -> {target}')

    case_text = (BASE / '验收/测试用例.md').read_text()
    all_ids = [int(i) for i in re.findall(r'^### T(\d+)\s', case_text, re.M)]
    if sorted(all_ids) != list(range(1, 73)):
        failures.append('case IDs must be unique T01..T72')
    required = ['用例编号', '关联需求／原型状态', '测试层级', '前置条件',
                '环境与测试数据', '具体操作步骤', '明确预期结果', '实际结果', '状态', '证据／缺陷链接']
    for n in range(48, 73):
        match = re.search(rf'^### T{n}\s.*?(?=^### T|\Z)', case_text, re.M | re.S)
        if not match or any(f'| {field} |' not in match.group() for field in required):
            failures.append(f'T{n}: missing required field')
        elif '| 状态 | 待执行' not in match.group():
            failures.append(f'T{n}: must remain pending')

    req_text = (BASE / '需求.md').read_text()
    for n in range(5, 15):
        if len(re.findall(rf'^\| M10-R10-{n:02d} \|', req_text, re.M)) != 1:
            failures.append(f'R10-{n:02d}: missing or duplicate requirement')

    design = (BASE / '技研/应用包与Agent运行时详细设计R1.6.md').read_text()
    examples = re.findall(r'^```json\n(.*?)^```', design, re.M | re.S)
    for sample in examples:
        try:
            obj = json.loads(sample)
            for name, config in obj.get('mcpServers', {}).items():
                assert isinstance(config['args'], list), name
                assert config['env']['ELECTRON_RUN_AS_NODE'] == '1', name
        except (ValueError, KeyError, AssertionError) as exc:
            failures.append(f'JSON example invalid: {exc}')

    diff = command('git', 'diff', '--check')
    if diff.returncode:
        failures.append('git diff --check: ' + diff.stdout + diff.stderr)

    cli_dir = ROOT / 'release/m10-research/runtime-design-r16-20261019'
    help_files = sorted(cli_dir.glob('*.txt'))
    for tool in ('claude', 'codex'):
        for suffix in ('help', 'version'):
            if not (cli_dir / f'{tool}-{suffix}.txt').is_file():
                failures.append(f'missing saved read-only CLI output: {tool}-{suffix}')

    result = {
        'schema': 'm10-runtime-design-document-validation-v1',
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'scope': 'documentation and source fingerprints only; no product test execution',
        'requirements': 'R1.6-20261019',
        'branch': command('git', 'branch', '--show-current').stdout.strip(),
        'baseCommit': command('git', 'rev-parse', 'HEAD').stdout.strip(),
        'worktree': 'uncommitted; pre-existing prototype and document changes preserved',
        'checks': {
            'localMarkdownFileTargets': link_count,
            'note': 'Anchor semantics, native loader behavior and platform support are not proven by this script.',
            'caseIds': {'total': len(all_ids), 'newPending': 25},
            'newRequirementIds': 10,
            'jsonExamplesParsed': len(examples),
            'balancedCodeFences': True,
            'gitDiffCheckExitCode': diff.returncode,
        },
        'status': 'passed' if not failures else 'failed',
        'failures': failures,
        'documents': [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for p in DOCS],
        'sourceFilesRead': [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for p in SOURCES],
        'readOnlyCliOutputs': [
            {'path': str(p.relative_to(ROOT)), 'sha256': sha(p),
             **({'version': p.read_text().strip()} if p.name.endswith('-version.txt') else {})}
            for p in help_files
        ],
        'validator': {'path': str(Path(__file__).resolve().relative_to(ROOT)), 'sha256': sha(Path(__file__))},
        'separateExecutionEvidence': '技研/实验/runtime-preflight-20261019/README.md; actual probe results are recorded separately, never inferred from this document check',
        'notExecutedByThisValidator': [
            'T48-T72', 'native Skill discovery/read/use', 'real session resume',
            'packaged MCP bridge', 'SQLite migrations or app upgrades',
            'R1.6 prototype changes', 'Windows/Linux runtime validation'
        ]
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'localLinks': link_count,
                      'cases': len(all_ids), 'failures': failures}, ensure_ascii=False))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
