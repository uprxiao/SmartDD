#!/usr/bin/env python3
"""Regenerate the reviewable C14 inventory; never modify production sources."""
from pathlib import Path
import hashlib
import json
import re

here = Path(__file__).resolve().parent
repo = next(p for p in here.parents if (p / 'src/main/db/schema.ts').exists())
sources = {p: p.read_text() for p in (repo / 'src').rglob('*') if p.is_file() and p.suffix in ['.ts', '.tsx', '.mjs']}
imports = {}
for p, text in sources.items():
    for spec in re.findall(r'''(?:from\s*|import\()['"]([^'"]+)['"]''', text):
        imports.setdefault(spec.rsplit('/', 1)[-1], set()).add(str(p.relative_to(repo)))
rows = []
for p, text in sorted(sources.items()):
    name = str(p.relative_to(repo))
    category = action = ''
    if '/applications/plugins/' in name and 'legacy-' in p.name:
        category, action = '保留：M10 插件数据兼容', '保留；不纳入终端任务兼容层批量删除'
    elif p.name.startswith('legacy-') and '/__tests__/' not in name:
        category, action = '旧任务／配置兼容层', '逐调用方核验；删除已由新路径替代的旧任务分支，独立业务语义保留'
    elif re.search(r'(pty-buffer|terminal-fit|terminal-keys|terminal-size|auto-resume|resume-advice|task-view)', p.name):
        category, action = '终端即任务 UI', '删除中央任务终端相关实现；手动终端所需通用函数抽取保留'
    elif p.name in ['pty-manager.ts', 'pty-access.ts']:
        category, action = '手动终端保留', '保留 PTY 核心；删除 Agent 任务／自动恢复绑定，补手动 shell 回归'
    elif re.search(r'ptyId|pty_id', text):
        category, action = '运行身份接口改造', 'Agent 路径改读 task/binding/run/generation 和出生身份；手动终端参数保留'
    if not category:
        continue
    rows.append({'path': name, 'category': category, 'action': action,
                 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                 'lines': [i for i, line in enumerate(text.splitlines(), 1) if re.search(r'ptyId|pty_id', line)],
                 'callers': sorted(imports.get(p.stem, set()) - {name})})
(here / 'cleanup-inventory.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
doc = '''# M14 旧代码清理清单

日期：2026-11-16。依据：需求 R1.0 R10、复核 C14／D1。**本次只编制清单，不删除生产代码。** 时机为 M14 新界面开发完成且测试通过后、发版之前；清理后执行 M14-A61 及其引用的全部受影响业务回归。

本表由[生成器](实验/20261116_复核修订验证/generate-cleanup.py)生成，源哈希、精确命中行和静态调用方在[原始清单](实验/20261116_复核修订验证/cleanup-inventory.json)。实施时先反查导出符号、IPC handler、注册项、间接调用和测试；静态 import 不是完整调用图。删除后类型检查及相关单元／集成通过，再跑打包 App。旧任务数据、原生文件、关联业务记录保留。

| 文件 | 分类 | 动作 | 静态调用方 |
| --- | --- | --- | --- |
'''
for r in rows:
    doc += f"| [{r['path']}](../../../../{r['path']}) | {r['category']} | {r['action']} | " + '、'.join('`' + x + '`' for x in r['callers']) + ' |\n'
doc += '''
CLI 专用“插入终端”、Codex 私有客户端参数和 CLI 沙箱核验随对应旧入口删除；SDK 权限映射、业务授权和内核进程认证继续保留。`pty-manager`／`pty-access` 保留给手动终端；`plugins/legacy-zentao-data`、`legacy-routing`、`legacy-result` 等 M10 数据语义单独保留，不能按名称批删。
'''
(here.parents[1] / '旧代码清理清单.md').write_text(doc)
print(json.dumps({'entries': len(rows), 'productionChanges': 0}))
