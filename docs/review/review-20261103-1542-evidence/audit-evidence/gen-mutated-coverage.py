"""Generate the M12 80-command mapping table from Orca's CLI specs.

Usage: python3 -I gen_command_map.py <orca repo> <output.md>
Also writes, next to <output.md>: exec-allowlist.json and 命令用例对照.generated.md (review 2026-11-03 R02, R05, R14).
The Orca source is read, never modified. Rules come from M12 需求 R0.6 (P1 mixed, P2/R02.11, P3/P4, O6, C5, K12, K13).
"""
import re
import sys

import json
import os

ORCA, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(OUT))

GROUPS = {}
text = open(f'{ORCA}/src/shared/orca-browser-cli-commands.ts', encoding='utf-8').read()
block = text[text.index('ORCA_BROWSER_CLI_COMMAND_KEYS'):text.index('as const satisfies')]
for group, body in re.findall(r"'(browser-[a-z]+)':\s*\[(.*?)\]", block, re.S):
    for key in re.findall(r"'([^']+)'", body):
        GROUPS[key] = group.replace('browser-', '')

USAGE = {}
for spec in ['browser-basic.ts', 'browser-advanced.ts']:
    src = open(f'{ORCA}/src/cli/specs/{spec}', encoding='utf-8').read()
    for m in re.finditer(r"path:\s*\[([^\]]*)\](.*?)usage:\s*\n?\s*(['\"`])(.*?)\3", src, re.S):
        path = ' '.join(x.strip().strip("'") for x in m.group(1).split(','))
        USAGE[path] = ' '.join(m.group(4).split())

NOT_PAGE_TARGETED = {'open-url', 'tab list', 'tab current', 'tab create', 'tab profile list', 'tab profile create',
                     'tab profile delete', 'browser identity get', 'browser identity set'}
READ = {'snapshot', 'screenshot', 'full-screenshot', 'pdf', 'get', 'is', 'wait', 'tab list', 'tab show', 'tab current',
        'tab profile list', 'tab profile show', 'cookie get', 'intercept list', 'console', 'network', 'clipboard read',
        'storage local get', 'storage session get', 'browser identity get'}
FILE_ALWAYS = {'screenshot', 'full-screenshot', 'pdf'}
FILE_OVERFLOW = {'snapshot', 'console', 'network', 'get', 'eval', 'cookie get', 'storage local get', 'storage session get',
                 'clipboard read', 'tab list'}
TEXT_FLAGS = {'fill': ['value'], 'type': ['input'], 'inserttext': ['text'], 'clipboard write': ['text'],
              'dialog accept': ['text'], 'storage local set': ['value'], 'storage session set': ['value'],
              'cookie set': ['value'], 'set credentials': ['user', 'pass'], 'eval': ['expression'],
              'find': ['value', 'text'], 'select': ['value'], 'wait': ['text', 'fn']}
SECRET_FLAGS = {'set credentials': ['pass']}
NOTES = {
    'open-url': '**不适用（用户 2026-11-03 确认）**，不实现，调用返回未知命令。Orca 用于远程配对场景，在承载终端的那台桌面上打开网址；WillYou 是单机，等价操作为 `tab create --url`',
    'browser identity set': 'O12：对标 Orca 全部开放；影响全应用、需重启，Skill 写明非必要不用',
    'exec': 'R0.9（review R02）：改为白名单，只放行 `exec-allowlist.json` 列出的页面操作子命令及其参数；其余（含 `connect`、`batch`、`close`、`tab`、`stream`、`auth`、全局参数）一律拒绝；CDP 代理再做第二道检查',
    'wait': 'R02.8：默认 25 秒；`--timeout` 上限 90 秒（K12，网关单次约 120 秒）',
    'goto': '宿主侧导航超时 60 秒（Orca 同）',
    'reload': '宿主侧超时 60 秒（Orca 同）',
    'upload': 'O7：路径不限制（对标 Orca，已接受风险）；`--files` 可用逗号串或 `--json` 传数组',
    'download': 'O7：路径不限制；结果返回实际保存路径（C13）',
    'set credentials': 'C5：密码用 `--stdin pass` 传入；日志脱敏（R06.5）',
    'set headers': '值按 JSON 解析后直接是对象（Orca 收 JSON 字符串），模式接受对象',
    'cookie get': 'O11：可读明文会话令牌（已接受风险）',
    'intercept enable': 'O9：仅记录，不能 mock／阻断／改写',
    'console': 'O8：接收 `--limit` 但忽略',
    'network': 'O8：接收 `--limit` 但忽略',
    'tab switch': 'R07.8：默认只切换页面、不切走用户视图；`--focus true` 才切换右侧工作区',
    'tab profile delete': 'R05：项目默认 profile 不能删除；删除后用它的标签回到项目 profile',
    'tab profile create': 'C1：账号不同时为任务新建独立 profile；`--scope imported` 只建空 profile，导入 Cookie 只能由用户在界面完成（O11）',
    'snapshot': 'R03：引用 `@eN` 按页面隔离；失效返回 `browser_stale_ref`（E1 实测报错 `Unknown ref`）',
}


def willyou(key):
    parts = key.split(' ')
    if parts[0] == 'browser':
        parts = parts[1:]
    return 'willyou-app browser ' + ' '.join(parts)


def willyou_usage(key, usage):
    """Orca usage rewritten for willyou-app: --worktree -> --task, no --json, bare switches get an explicit `true` value (R05)."""
    text = re.sub(r'^orca (browser )?', '', usage)
    text = text.replace(key.removeprefix('browser ') if key.startswith('browser ') else key, '', 1).strip()
    text = re.sub(r'--worktree <[^>]*>', '--task <任务ID>', text.replace('[--json]', ''))
    toks = re.split(r'(\s+)', text)
    out = []
    for i, tok in enumerate(toks):
        out.append(tok)
        bare = re.fullmatch(r'[\[(]*(--[A-Za-z][A-Za-z0-9-]*)[\])]*', tok)
        if bare and bare.group(1) not in ('--json',):
            rest = ''.join(toks[i + 1:]).lstrip()
            if not rest.startswith('<') and not rest.startswith('"<'):
                out[-1] = tok.replace(bare.group(1), bare.group(1) + ' true')
    return (willyou(key) + ' ' + ' '.join(''.join(out).split())).strip()


def native_parse(argv):
    """Mirror of native/applications/cli.mm argument rules: segments, then `--key value` pairs only."""
    i = 0
    segments = []
    while i < len(argv) and not argv[i].startswith('--'):
        segments.append(argv[i]); i += 1
    assert 2 <= len(segments) <= 8 and all(SEGMENT.match(x) for x in segments), f'segments {segments}'
    seen = set()
    while i < len(argv):
        key = argv[i]
        assert key.startswith('--') and i + 1 < len(argv), f'{key} has no value (willyou-app requires --field value)'
        name = key[2:]
        assert FLAG.match(name) and name not in RESERVED and name not in seen, f'bad or repeated field {key}'
        seen.add(name); i += 2


def example_argv(usage):
    """Fill one concrete example from a willyou usage: every optional flag included, first alternative of (a | b), placeholders -> x."""
    text = re.sub(r'\(([^()|]*)\|[^()]*\)', r'\1', usage)
    text = text.replace('[', ' ').replace(']', ' ')
    text = re.sub(r'"?<[^>]*>"?', 'x', text)
    return text.split()[1:]


def flags_change(key, usage):
    out = []
    if '--worktree' in usage:
        out.append('`--worktree` → `--task <任务ID>`（P4：仅同项目，弹窗授权）')
    if key not in NOT_PAGE_TARGETED:
        out.append('保留 `--page`')
    for flag in TEXT_FLAGS.get(key, []):
        how = '必须' if flag in SECRET_FLAGS.get(key, []) else '建议'
        out.append(f'`--{flag}` 文本，{how}用 `--stdin {flag}`')
    out.append('去掉 `--json`（总是 JSON）')
    bare = [t for t in re.findall(r'--[A-Za-z][A-Za-z0-9-]*', willyou_usage(key, usage).replace('true', '')) if f'{t} true' in willyou_usage(key, usage)]
    if bare:
        out.append('开关参数写显式值：' + '、'.join(f'`{t} true`' for t in bare))
    return '；'.join(out)


SEGMENT = re.compile(r'^[a-z][a-z0-9-]{0,63}$')
FLAG = re.compile(r'^[a-zA-Z][a-zA-Z0-9-]{0,63}$')
RESERVED = {'token', 'endpoint', 'runId', 'run-id', 'projectId', 'project-id', 'connectionId', 'connection-id', 'approved', 'json', 'stdin'}


def check(key, usage):
    segments = willyou(key).split(' ')[1:]
    assert 2 <= len(segments) <= 8 and all(SEGMENT.match(x) for x in segments), f'invalid willyou-app command for {key}'
    for flag in re.findall(r'--([A-Za-z][A-Za-z0-9-]*)', usage):
        if flag in ('json', 'worktree'):
            continue
        assert FLAG.match(flag) and flag not in RESERVED, f'flag --{flag} of {key} collides with willyou-app rules'


EXTRAS = [
    ('access', 'browser access request', 'willyou-app browser access request --task <任务ID> --mode <observe|control>', '写（operation-receipt）', 'P4／R06.3：申请跨任务授权，宿主弹窗；申请本身不要求已有授权（review R03）'),
    ('operation', 'browser operation get', 'willyou-app browser operation get --request <requestId>', '读', 'R0.9（review R04）：按原调用的 requestId 查询写命令的结果：成功／失败／未知／不存在；只能查本次运行自己的调用'),
]
COVERAGE = {
    'browser identity get': ['T089'], 'browser identity set': ['T089'],
    'snapshot': ['T999'], 'screenshot': ['T054'], 'goto': ['T072'], 'back': ['T072'], 'reload': ['T072'], 'forward': ['T072'],
    'eval': ['T057'], 'scroll': ['T061'], 'wait': ['T036', 'T066'], 'pdf': ['T056'], 'full-screenshot': ['T055'],
    'click': ['T061'], 'dblclick': ['T061'], 'fill': ['T063', 'T064'], 'type': ['T060', 'T063'], 'select': ['T063'], 'check': ['T063'], 'uncheck': ['T063'],
    'focus': ['T063'], 'clear': ['T063'], 'select-all': ['T063'], 'keypress': ['T063'], 'hover': ['T061'], 'drag': ['T061'], 'upload': ['T067'],
    'scrollintoview': ['T061'], 'get': ['T058'], 'is': ['T058'], 'inserttext': ['T063'], 'mouse move': ['T062'], 'mouse down': ['T062'], 'mouse up': ['T062'],
    'mouse wheel': ['T062'], 'find': ['T065'], 'download': ['T067'], 'highlight': ['T061'],
    'open-url': ['T030'], 'tab list': ['T034', 'T073'], 'tab show': ['T073'], 'tab current': ['T073'], 'tab switch': ['T073', 'T115'], 'tab create': ['T073', 'T105'],
    'tab close': ['T073'], 'exec': ['T039'],
    'tab profile list': ['T075'], 'tab profile create': ['T075', 'T077'], 'tab profile delete': ['T075', 'T079'], 'tab profile set': ['T075'], 'tab profile show': ['T075'],
    'tab profile use-default': ['T075'], 'tab profile clone': ['T075'],
    'cookie get': ['T084'], 'cookie set': ['T084'], 'cookie delete': ['T084'],
    'intercept enable': ['T071'], 'intercept disable': ['T071'], 'intercept list': ['T071'], 'capture start': ['T070'], 'capture stop': ['T070'], 'console': ['T069'], 'network': ['T069'],
    'viewport': ['T086'], 'geolocation': ['T086'], 'set device': ['T086'], 'set offline': ['T086'], 'set headers': ['T086'], 'set credentials': ['T087'], 'set media': ['T086'],
    'clipboard read': ['T088'], 'clipboard write': ['T088'], 'dialog accept': ['T068'], 'dialog dismiss': ['T068'],
    'storage local get': ['T085'], 'storage local set': ['T085'], 'storage local clear': ['T085'], 'storage session get': ['T085'], 'storage session set': ['T085'], 'storage session clear': ['T085'],
    'browser access request': ['T095', 'T096'], 'browser operation get': ['T037', 'T094'],
}

rows = []
for key, group in GROUPS.items():
    check(key, USAGE.get(key, ''))
    usage = USAGE.get(key, '（未在 specs 中找到）')
    semantics = '读' if key in READ else '写（operation-receipt）'
    result = '总是写文件，返回路径' if key in FILE_ALWAYS else ('超限转文件' if key in FILE_OVERFLOW else '内联')
    disposition = '不适用' if key == 'open-url' else '保留'
    wy = willyou_usage(key, usage) if key in USAGE else willyou(key)
    if disposition == '保留':
        native_parse(example_argv(wy))
    rows.append((group, key, usage, wy, flags_change(key, usage), semantics, result, disposition, NOTES.get(key, '')))
for group, key, wy, semantics, note in EXTRAS:
    native_parse(example_argv(wy))
    rows.append((group, key, '（WillYou 新增）', wy, '—', semantics, '内联', '新增', note))
missing = [r[1] for r in rows if not COVERAGE.get(r[1])]
assert not missing, f'commands without a test case: {missing}'
assert len(COVERAGE) == len(rows), 'coverage table lists unknown commands' 

counts = {}
for r in rows:
    counts[r[0]] = counts.get(r[0], 0) + 1
reads = sum(1 for r in rows if r[5] == '读')
kept = sum(1 for r in rows if r[7] == '保留')
added = sum(1 for r in rows if r[7] == '新增')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('<!-- 由 gen_command_map.py 生成，勿手改；改规则后重新生成 -->\n\n')
    f.write(f'共 {len(rows)} 条：' + '、'.join(f'{g} {n}' for g, n in counts.items()) + f'。Orca 80 条中保留 {kept} 条、不适用 1 条（open-url）；WillYou 新增 {added} 条（`access request`、`operation get`）；**实现 {kept + added} 条**，其中读 {sum(1 for r in rows if r[5] == "读" and r[7] != "不适用")} 条、写 {sum(1 for r in rows if r[5] != "读" and r[7] != "不适用")} 条。每条 WillYou 用法都按原生 CLI 参数规则解析通过。\n\n')
    f.write('| # | 组 | Orca 命令 | Orca 用法 | WillYou 命令 | 参数变化 | 语义 | 结果交付 | 处理 | 备注 |\n')
    f.write('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n')
    for i, r in enumerate(rows, 1):
        cells = [str(i), r[0], f'`{r[1]}`', f'`{r[2]}`', f'`{r[3]}`', r[4], r[5], r[6], r[7], r[8]]
        f.write('| ' + ' | '.join(c.replace('|', '\\|') if not c.startswith('`') else c.replace('|', '\\|') for c in cells) + ' |\n')
ALLOW = {
    'note': 'R0.9 exec 白名单（review R02）。依据 agent-browser 0.27.3 `--help`。只放行页面内操作；带专用命令且需要宿主交付文件的（screenshot、pdf、download、network har）、改变连接或会话的（connect、close、tab、session、batch）、写磁盘或开服务的（record、trace、profiler、stream、auth、state、inspect、dashboard、chat、install、upgrade、doctor、profiles、skills）、导航（open，统一用 goto 以执行宿主地址规则）一律拒绝。任何以 - 开头、不在该子命令 options 中的参数都拒绝（含 --cdp、--session、--ignore-https-errors、--init-script、--extension、--proxy、--config）。',
    'commands': {
        'click': [], 'dblclick': [], 'type': [], 'fill': [], 'press': [], 'keyboard': [], 'hover': [], 'focus': [], 'check': [], 'uncheck': [], 'select': [], 'drag': [],
        'upload': [], 'scroll': [], 'scrollintoview': [], 'wait': [], 'snapshot': ['-i', '--interactive', '-c', '--compact', '-d', '--depth', '-s', '--selector'], 'eval': [],
        'back': [], 'forward': [], 'reload': [], 'get': [], 'is': [], 'find': ['--name', '--exact'], 'mouse': [], 'set': [],
        'network': {'route': ['--abort', '--body', '--resource-type'], 'unroute': [], 'requests': ['--clear', '--filter', '--type', '--method', '--status'], 'request': []},
        'cookies': ['--url', '--domain', '--path', '--httpOnly', '--secure', '--sameSite', '--expires'], 'storage': [], 'console': ['--clear'], 'errors': ['--clear'],
        'highlight': [], 'clipboard': [], 'dialog': [], 'diff': {'snapshot': []}, 'vitals': [], 'pushstate': [],
    },
}
with open(os.path.join(HERE, 'exec-allowlist.json'), 'w', encoding='utf-8') as f:
    json.dump(ALLOW, f, ensure_ascii=False, indent=1)
    f.write('\n')
with open(os.path.join(HERE, '命令用例对照.generated.md'), 'w', encoding='utf-8') as f:
    f.write('<!-- 由 gen_command_map.py 生成，勿手改 -->\n\n每条实现的命令至少对应一条测试用例（[测试用例](../../验收/测试用例.md)）；生成器发现缺项会失败。\n\n| 命令 | 处理 | 用例 |\n| --- | --- | --- |\n')
    assert all('--worktree' not in r[3] for r in rows), 'a WillYou usage still mentions --worktree'
    for r in rows:
        f.write(f'| `{r[1]}` | {r[7]} | ' + '、'.join('M12-' + t for t in COVERAGE[r[1]]) + ' |\n')
print(len(rows), counts, 'read', reads, 'kept', kept, 'added', added)
