#!/usr/bin/env python3
"""Bounded M10 inventory; reads research files and writes only audit/index output."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import hashlib
import json
import os

ROOT = Path(__file__).resolve().parents[4]
STAGE = ROOT / 'docs/里程碑/M10_三方应用接入'
AUDIT = Path(__file__).resolve().parent
INDEX = STAGE / '文件索引与开工校验.md'
INVENTORY = STAGE / '验收/证据/m10-file-inventory-audit-20261017-1559.json'
RAW = ROOT / 'release/m10-research'
MARKER = '<!-- M10_INVENTORY_APPENDIX -->'


def relative(path):
    return str(path.relative_to(ROOT))


def record(path, hashed=True):
    exists = path.is_file()
    result = {'path': relative(path) if path.is_relative_to(ROOT) else str(path), 'exists': exists}
    if path == INVENTORY:
        result.update({'exists': True, 'bytes': None, 'sha256': None,
                       'note': 'Inventory self-entry omits size/hash to avoid self-reference.'})
    elif exists:
        result['bytes'] = path.stat().st_size
        result['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest() if hashed else None
    return result


def link(path):
    target = os.path.relpath(path, STAGE)
    return f'[{target}](<{target}>)'


def main():
    stage_files = sorted(set(p for p in STAGE.rglob('*') if p.is_file()) | {INVENTORY})
    raw_groups = []
    for group in sorted(RAW.iterdir()):
        files = sorted(p for p in group.rglob('*') if p.is_file()) if group.is_dir() else [group]
        raw_groups.append({'root': relative(group), 'fileCount': len(files),
                           'bytes': sum(p.stat().st_size for p in files),
                           'files': [record(p, hashed=False) for p in files]})
    appendix = ['## 6. 原始材料逐组清单', '',
                '以下为本机普通文件的路径／大小清点；忽略目录不随Git提交。原有来源manifest和快照manifest负责其历史哈希，未在本轮重复哈希全部大型导出。', '',
                '| 本机目录（`release/m10-research/`下） | 文件数 | 总字节 | 归属 |',
                '| --- | ---: | ---: | --- |']
    purposes = {
        'connection-v1': 'Codex连接生命周期REA原始导出',
        'tool-use-v1': 'Codex使用链路REA原始导出',
        'extension-v2': 'Codex多应用扩展REA与来源材料',
        'protocol-v1': '公开协议生成schema与运行时原始报告',
        'official-zentao-api': '固定版本SDK定义与来源材料',
        'prototype-v2': '原型构建／模型原始日志',
        'prototype-v2-baseline-20261017': '共享原型可恢复快照，包含清单',
        'v1-archive-20261017': '阶段V1快照，包含清单',
        'v2-archive-before-audit-20261017-1559': '本轮审查更新前完整阶段121文件',
        'before-scope-20261017': '编号／范围调整前历史，不作现行需求',
        'before-r12-20261017': 'R1.2修改前快照',
        'before-technical-v1-20261017': '技术主案修改前快照',
        'before-prototype-v2-20261017': 'V2原型修改前快照',
    }
    for group in raw_groups:
        name = Path(group['root']).name
        appendix.append(f"| `{name}/` | {group['fileCount']} | {group['bytes']:,} | {purposes.get(name, '其他有界研究材料')} |")
    appendix += ['', f"合计{sum(g['fileCount'] for g in raw_groups)}文件，{sum(g['bytes'] for g in raw_groups):,}字节。这里只清点目录，未执行其中源码。", '',
                 '## 7. 阶段内全部文件', '',
                 f'共{len(stage_files)}文件（原有121＋本索引＋机器目录）。路径逐项列出；`attempt`为迭代证据，`final`为该轮原型最终证据，二者均保留。']
    categories = [
        ('文档', lambda p: p.suffix == '.md'),
        ('实验／检查脚本', lambda p: p.suffix in {'.py', '.ts', '.mjs'}),
        ('JSON证据与许可', lambda p: p.suffix == '.json' or p.name.endswith('.LICENSE')),
        ('截图', lambda p: p.suffix == '.png'),
    ]
    listed = []
    for title, predicate in categories:
        subset = [p for p in stage_files if predicate(p)]
        listed.extend(subset)
        appendix += ['', f'### {title}（{len(subset)}）', '']
        appendix += ['- ' + link(p) for p in subset]
    assert sorted(listed) == stage_files, 'Unclassified or repeated stage files'
    shared = [ROOT / p for p in [
        'prototypes/m6-codex/src/IntegrationWorkspace.jsx',
        'prototypes/m6-codex/src/integration-model.mjs',
        'prototypes/m6-codex/src/integration.css',
        'prototypes/m6-codex/tests/integration-model.test.mjs',
        'prototypes/m6-codex/src/App.jsx',
    ]]
    entries = [ROOT / p for p in [
        'AGENTS.md', 'CLAUDE.md', 'docs/需求池.md', 'docs/里程碑/README.md',
        'docs/M8-M11_里程碑规划.md', 'docs/SmartDD_V0.2_PRD.md',
        'prototypes/m6-codex/AGENTS.md', 'prototypes/m6-codex/README.md',
        'prototypes/m6-codex/design-qa.md', 'prototypes/m6-codex/package.json',
        'prototypes/m6-codex/package-lock.json', 'prototypes/m6-codex/index.html',
    ]]
    appendix += ['', '## 8. 阶段外关联文件', '',
                 '以下源码为M10模块及挂接；`App.jsx`同时承载其他阶段，不把其全部改动算作M10。共享规则／导航仅引用，未在本轮修改。', '',
                 '### 共享原型中的M10源码／测试', '']
    appendix += ['- ' + link(p) for p in shared]
    appendix += ['', '### 导航与共享工程资料', '']
    appendix += ['- ' + link(p) for p in entries]
    appendix += ['', '### 本轮审查与逐文件证据', '',
                 '- ' + link(ROOT / 'docs/review/review-20261017-1559.md')]
    audit_files = sorted(set(p for p in AUDIT.rglob('*') if p.is_file()) | {AUDIT / 'file-validation.json'})
    appendix += ['- ' + link(p) for p in audit_files]
    INDEX.write_text(INDEX.read_text().split(MARKER)[0] + MARKER + '\n\n' + '\n'.join(appendix) + '\n')
    metadata = json.loads((STAGE / '调研/证据/zentao-biz13-reuse-metadata.json').read_text())
    external = [record(Path(item['resolved_path'])) for item in metadata['local_sources']]
    for output, original in zip(external, metadata['local_sources']):
        output['historicalSha256'] = original['sha256']
        output['matchesHistoricalSha256'] = output.get('sha256') == original['sha256']
    inventory = {
        'schema': 'm10-complete-file-inventory-v1',
        'at': datetime.now(timezone.utc).isoformat(),
        'workspace': str(ROOT), 'branch': 'feature/0.0.1',
        'baseline': 'R1.3-20261017; technical/prototype V2; audit 20261017-1559',
        'readiness': 'not_ready_for_whole_m10_formal_development',
        'boundaries': [
            'Only the stage, this audit, enumerated shared paths, referenced legacy code and release/m10-research were inventoried.',
            'No original mail data, secret profiles, browser sessions or unrelated private directories were inventoried.',
            'Raw research files have path/size only; original source manifests retain historical hashes.',
            'Shared prototype files are not wholly owned by M10; concurrent M9 changes were preserved.',
            'Inventory excludes its own size/hash; file-validation.json is recorded without hash because it validates this inventory.',
        ],
        'beforeAuditArchive': 'release/m10-research/v2-archive-before-audit-20261017-1559',
        'stage': {'root': relative(STAGE), 'originalFileCount': 121,
                  'fileCount': len(stage_files), 'extensions': dict(sorted(Counter(p.suffix for p in stage_files).items())),
                  'files': [record(p) for p in stage_files]},
        'sharedM10SourcesAndTests': [record(p) for p in shared],
        'sharedEntriesAndGuides': [record(p) for p in entries],
        'externalLegacyBugReferences': external,
        'auditReport': record(ROOT / 'docs/review/review-20261017-1559.md'),
        'auditEvidence': [record(p) if p.name != 'file-validation.json' else {
            'path': relative(p), 'exists': p.is_file(), 'bytes': None, 'sha256': None,
            'note': 'Validation result is excluded from size/hash to avoid cross-reference.'
        } for p in audit_files],
        'rawResearch': {'root': relative(RAW), 'fileCount': sum(g['fileCount'] for g in raw_groups),
                        'bytes': sum(g['bytes'] for g in raw_groups), 'groups': raw_groups},
    }
    INVENTORY.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'stageFiles': len(stage_files), 'rawFiles': inventory['rawResearch']['fileCount'],
                      'auditFiles': len(audit_files), 'inventory': relative(INVENTORY)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
