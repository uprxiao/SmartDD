#!/usr/bin/env python3
"""Generate each current experiment's replay instructions from actual inputs."""
from pathlib import Path
import collections
import hashlib
import json
import re
import tarfile

base = Path(__file__).resolve().parent
env = json.loads((base / '_运行环境/collection-manifest.json').read_text())
byhash = collections.defaultdict(list)
for f in env['files']:
    byhash[f['sha256']].append(f['source'])
experiments = []
for d in sorted(base.iterdir()):
    if not d.is_dir() or not d.name.startswith('2026'):
        continue
    entries = {}
    archives = []
    for f in d.rglob('*'):
        if f.is_file() and f.suffix in ['.mjs', '.py', '.sh']:
            entries[str(f.relative_to(d))] = f.read_bytes()
    for a in d.glob('*.tar.gz'):
        archives.append({'file': a.name, 'sha256': hashlib.sha256(a.read_bytes()).hexdigest()})
        with tarfile.open(a) as tf:
            for m in tf.getmembers():
                if m.isfile() and m.name.endswith(('.mjs', '.py', '.sh')) and m.size < 1_000_000:
                    entries.setdefault(m.name, tf.extractfile(m).read())
    candidates = sorted(entries, key=lambda n: (len(Path(n).parts), Path(n).name not in ['probe.mjs', 'main.mjs', 'test.mjs'], n))
    selected = next((n for n in candidates if Path(n).name in ['probe.mjs', 'main.mjs', 'test.mjs']), candidates[0] if candidates else None)
    if d.name=='20261116_二次复核修订验证':selected='real-async-writers.mjs'
    if d.name=='20261114_上下文投递验证':selected='attempt-3/handoff_probe.py'
    if d.name=='20261114_同步与草稿合同验证':selected='attempt-3/probe.py'
    if d.name=='20261114_F04配置来源优先级与外部修订验证':selected='contract-probe.mjs'
    if d.name=='20261114_长输出缓冲与存储故障验证':selected='stream-probe.mjs'
    roots = collections.Counter()
    for n, data in entries.items():
        if len(Path(n).parts) > 2:
            continue
        for source in byhash[hashlib.sha256(data).hexdigest()]:
            match = re.match(r'(/private/tmp/willyou-m14-[^/]+)/', source)
            if match:
                roots[match[1]] += 10 if n == selected else 1
    original = roots.most_common(1)[0][0] if roots else None
    runner = 'electron' if any('electron' in n.lower() or b"from 'electron'" in data or b'from "electron"' in data for n, data in entries.items() if len(Path(n).parts) < 3) else 'node'
    if selected and selected.endswith('.py'):runner='python'
    if selected and Path(selected).name=='main.mjs' and '浏览器' in d.name:runner='electron'
    mode = '插件拒绝卸载与不兼容更新' in d.name
    builders = [n for n in candidates if Path(n).name.startswith('build') and n.endswith('.mjs') and len(Path(n).parts) < 3]
    entry = {'name': d.name, 'entry': selected, 'runner': runner, 'modeRequired': mode,
             'originalRoot': original, 'buildEntries': builders, 'scripts': candidates, 'archives': archives,
             'dependencyLocks': ['_运行环境/deps/willyou-m14-owner-probe/package-lock.json', '_运行环境/deps/m14-sdk/package-lock.json'],
             'newExperiment': d.name in ['20261116_复核修订验证','20261116_二次复核修订验证']}
    experiments.append(entry)
    intro = f'''# 仓库外复跑：{d.name}

本文件由 [编制复跑目录.py](../编制复跑目录.py) 生成。历史脚本和证据保持原字节；依赖和环境准备统一见 [复跑说明](../复跑说明.md)。

| 项 | 实际输入 |
| --- | --- |
| 入口 | `{selected}` |
| 构建入口 | {', '.join('`'+x+'`' for x in builders) or '无独立 build；使用归档／补交的原输入'} |
| 原脚本位置 | {'、'.join('`'+a['file']+'`' for a in archives) or '本目录脚本；缺的共享输入由 _运行环境 恢复'} |
| 运行时 | {runner}；{'必须分别传 deny、uninstall、incompatible 模式' if mode else '入口参数沿原 README 中同名命令；不省略其数据前置'} |
| 依赖 | owner 与 SDK 的锁文件；Electron 场景另用 Electron ABI 的 better-sqlite3，见统一说明 |
| 内容寻址资产 | `bundles/`、`mcp-bridge.cjs`、`actual*.cjs` 不改写；需要当前源码构建时在副本另生成 |

环境变量均为本机路径，无秘密。`RUN` 必须是仓库外尚不存在的新目录：

```bash
python3 "$M14_EXPERIMENTS/复跑.py" "{d.name}" --out "$RUN" --prepare-only
```

准备回执在 `$RUN/preparation.json`；原包及 immutable 输入 SHA 保持一致，普通脚本只在副本重定位。执行前对照原 [README](README.md) 的步骤／环境前置。显式运行入口使用：

```bash
python3 "$M14_EXPERIMENTS/复跑.py" "{d.name}" --out "$NEXT_RUN" --run "{selected}"{' --mode deny' if mode else ''}
```

构建源码实验先用本条目列出的 build 入口在新副本执行，随后在同一副本运行 probe；不要覆盖归档产物。所有 esbuild build 统一注入 node-pty 替身，非 profile 构建也覆盖。浏览器主进程入口用 Electron，不能拿 Node 启动 main.mjs；ABI 不匹配时先准备独立 Electron 依赖目录。框架只重定位，不把实验通过／真实 App 通过预先写入回执。
'''
    if entry['newExperiment']:
        intro = f'# 本轮实验复跑：{d.name}\n\n本文件由[编制复跑目录.py](../编制复跑目录.py)生成。以本目录 [README](README.md) 的独立研究复跑命令和证据边界为准，不使用旧实验重定位器。真实模型命令需要既有登录／环境，不复制凭据；离线回放不需要登录。\n'
    (d / '复跑.md').write_text(intro)
(base / '实验目录.json').write_text(json.dumps({'generator': '编制复跑目录.py', 'experiments': experiments}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'currentExperiments': len(experiments), 'withoutEntry': [e['name'] for e in experiments if not e['entry']], 'withoutOriginalRoot': [e['name'] for e in experiments if not e['originalRoot']]}, ensure_ascii=False))
