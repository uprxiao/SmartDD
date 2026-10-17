#!/usr/bin/env python3
"""Validate or render M9 case documents from the reviewed JSON source.

No application, browser, external resource or test fixture is executed.
Usage: python3 维护用例索引.py --check | --write
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDEX = HERE / '用例覆盖索引.json'
CASES = HERE / '测试用例.md'
MAP = HERE / '需求与用例映射.md'
STABLE_GROUP_COUNTS = {
    'A': 13, 'B': 23, 'C': 19, 'D': 24, 'E': 17, 'F': 30, 'G': 12, 'H': 34,
    'J': 12, 'K': 11, 'L': 18, 'M': 12, 'N': 15, 'P': 10, 'Q': 4, 'R': 20,
    'S': 10, 'T': 35, 'U': 9, 'V': 17, 'W': 28, 'X': 12, 'Y': 40,
}
R33_FUTURE_CASE_IDS = {'M9-T-' + value for value in ('C19', 'M08', 'M09', 'M10', 'Y31', 'Y32')}
R33_MIXED_CASE_IDS = {'M9-T-' + value for value in ('J05', 'L08', 'M06', 'T22')}


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', '<br>')


def dependency_caption(case):
    parts = []
    for key, label in [('decision_dependencies', '用户决策'),
                       ('engineering_dependencies', '工程依赖'),
                       ('evidence_dependencies', '证据／基线评审')]:
        if case.get(key):
            parts.append(label + '：' + '/'.join(case[key]))
    return '；'.join(parts)


def scope_caption(case):
    rule = case['applicability']
    if rule['classification'] == 'current-local':
        return '本期本机'
    if rule['classification'] == 'future-remote':
        return '后续非本期（未安排M）；' + rule['deferred_branch']
    result = '本期：' + rule['current_branch']
    if rule['deferred_branch']:
        result += ' 后续参数：' + rule['deferred_branch']
    return result


def derive(data):
    coverage, parents = defaultdict(list), defaultdict(list)
    current_coverage, future_coverage = defaultdict(list), defaultdict(list)
    scopes = defaultdict(list)
    ids = set()
    requirements = (HERE.parent / '需求.md').read_text()
    known = {'M9-' + value for value in re.findall(r'\b(R\d{2}\.\d+)\b', requirements)}
    pages = set(re.findall(r'\| (P\d{2})\b', (HERE.parent / '原型/原型说明与变更.md').read_text()))
    for case in data['cases']:
        cid = case['id']
        assert cid not in ids, f'duplicate case: {cid}'
        ids.add(cid)
        assert re.fullmatch(r'M9-T-[A-Z]\d{2}', cid), cid
        assert case['group'] in data['groups'], cid
        assert re.fullmatch(rf'M9-T-{case["group"]}\d{{2}}', cid), cid
        for key in ('title', 'requirements', 'level', 'environments', 'data', 'steps', 'expected',
                    'source', 'prototype', 'prototype_pages', 'prototype_status', 'prototype_note', 'status'):
            assert case.get(key), f'{cid}: empty {key}'
        assert all(re.fullmatch(r'M9-R\d{2}\.\d+', req) for req in case['requirements']), f'{cid}: parent-only mapping'
        assert set(case['requirements']) <= known, f'{cid}: undefined requirements {set(case["requirements"]) - known}'
        assert set(case['prototype_pages']) <= pages, f'{cid}: undefined pages'
        for field in ('decision_dependencies', 'engineering_dependencies', 'evidence_dependencies'):
            assert set(case[field]) <= set(data['dependencies']), f'{cid}: undefined dependencies'
        assert not case['decision_dependencies'], f'{cid}: D01/D07 are resolved; no pending user decision remains'
        rule = case['applicability']
        classification = rule['classification']
        assert classification in {'current-local', 'current-nonlocal-rejection',
                                  'current-local-with-deferred-remote', 'future-remote'}, cid
        scopes[classification].append(cid)
        assert case['scope'] == ('future-remote' if classification == 'future-remote' else 'm9-local'), cid
        current_reqs, future_reqs = set(rule['current_requirements']), set(rule['deferred_requirements'])
        assert current_reqs | future_reqs == set(case['requirements']), f'{cid}: scope requirement mapping differs'
        assert not current_reqs.intersection(data['future_only_requirements']), f'{cid}: future-only requirement in current scope'
        if classification == 'future-remote':
            assert not rule['current_branch'] and not current_reqs and rule['deferred_branch'] and future_reqs, cid
        else:
            assert rule['current_branch'] and current_reqs, cid
            if classification == 'current-local-with-deferred-remote':
                assert rule['deferred_branch'] and future_reqs, cid
            else:
                assert not rule['deferred_branch'] and not future_reqs, cid
        for req in current_reqs:
            current_coverage[req].append(cid)
        for req in future_reqs:
            future_coverage[req].append(cid)
        current_contract = ' '.join(case[key] for key in ('title', 'steps', 'expected'))
        assert not any(stale in current_contract for stale in ('pending→review', 'pending → review', 'kept/reverted')), f'{cid}: superseded CLI review workflow in current contract'
        assert isinstance(case['evidence'], list) and isinstance(case['defects'], list), cid
        assert 'actual_result' in case, cid
        for req in case['requirements']:
            coverage[req].append(cid)
        for parent in sorted({req.split('.')[0] for req in case['requirements']}):
            parents[parent].append(cid)
    expected_ids = {f'M9-T-{group}{number:02}' for group, count in STABLE_GROUP_COUNTS.items()
                    for number in range(1, count + 1)}
    assert ids == expected_ids, 'Stable case IDs changed; preserve original 417 plus R3.2 Y33–Y40.'
    assert len(data['groups']) == 23
    for decision in ('D01', 'D07'):
        assert data.get('resolved_decisions', {}).get(decision, {}).get('status') == 'confirmed', f'{decision} resolution missing'
        assert data['resolved_decisions'][decision]['pending'] is False, f'{decision} still pending'
    if data['execution_status'] == 'not-executed':
        assert all(c['status'] == '未执行' and c['actual_result'] is None and not c['evidence'] and not c['defects']
                   for c in data['cases']), 'Execution metadata disagrees with case results.'
    data['case_count'] = len(ids)
    data['group_count'] = len(data['groups'])
    data['coverage'] = dict(sorted(coverage.items(), key=lambda p: tuple(map(int, p[0][4:].split('.')))))
    data['parent_coverage'] = dict(sorted(parents.items()))
    data['unmapped_requirements'] = sorted(known - set(coverage))
    data['current_coverage'] = dict(sorted(current_coverage.items()))
    data['future_coverage'] = dict(sorted(future_coverage.items()))
    data['current_unmapped_requirements'] = sorted(known - set(data['future_only_requirements']) - set(current_coverage))
    data['scope_summary'] = {
        'total': len(ids),
        'current': sum(len(values) for key, values in scopes.items() if key != 'future-remote'),
        'future_only': len(scopes['future-remote']),
        'current_local_only': len(scopes['current-local']),
        'current_nonlocal_rejection': len(scopes['current-nonlocal-rejection']),
        'current_with_deferred_parameters': len(scopes['current-local-with-deferred-remote']),
        'future_case_ids': sorted(scopes['future-remote']),
        'mixed_case_ids': sorted(scopes['current-local-with-deferred-remote']),
        'nonlocal_rejection_case_ids': sorted(scopes['current-nonlocal-rejection']),
    }
    assert data['scope_summary']['current'] + data['scope_summary']['future_only'] == len(ids)
    assert set(data['scope_summary']['future_case_ids']) == R33_FUTURE_CASE_IDS, 'R3.3 deferred cases changed without scope revision'
    assert set(data['scope_summary']['mixed_case_ids']) == R33_MIXED_CASE_IDS, 'R3.3 mixed branches changed without scope revision'
    assert data['future_only_requirements'] == ['M9-R08.12'], 'R08.9 rejection remains current; only R08.12 is wholly future'
    for key, group in data['groups'].items():
        group['req'] = ','.join(sorted({req.split('.')[0] for c in data['cases'] if c['group'] == key for req in c['requirements']}))
    return data


def render_cases(data):
    preamble = CASES.read_text().split('## 3. ', 1)[0].rstrip()
    preamble = re.sub(r'版本：R3(?:\.\d+)?-20261017', '版本：' + data['version'], preamble)
    preamble = preamble.replace('M9-R01–R09](../需求.md)', 'M9-R01–R09 子需求](../需求.md)')
    preamble = preamble.replace('任务引用/选择编辑', '任务上下文交接/独立磁盘同步')
    preamble = preamble.replace('R3补32条技术闸门/缺陷回归/业务接入，共417条/23组',
                                'R3补32条技术闸门/缺陷回归/业务接入，R3.2新增Y33–Y40共8条文件拖入终端用例，共425条/23组')
    preamble = preamble.replace(
        '| R | Codex指定版本/build/ASAR hash；独立临时项目和合成fixture；记录locale/feature flag可见状态 | 参考运行事实，仅做只读观察或已授权隔离样本操作；不能证明SmartDD |',
        '| R | 已归档Codex版本/build/ASAR hash及参考资料；仅引用既有证据，保留其locale/feature flag已知或未知边界 | 历史参考证据标签；当前禁止新增Codex操作或查看，不能证明WillYou |')
    reference_rule = ('**当前参考约束：用户已要求不再操作或查看 Codex。** 含 `R` 的用例保留既有编号及历史参考分支；'
                      '“观察/取证/参考录屏”等旧步骤不构成重新执行授权，也不能用原型结果补造参考证据。'
                      '只使用已归档的允许资料；未知参考状态明确保留未核对，WillYou 的 P/U/I/A/X 分支可按各阶段授权独立推进。')
    if reference_rule not in preamble:
        preamble += '\n\n' + reference_rule
    drop_fixture = ('| D17 | 文件拖放：可信根内真实txt/md/docx/pdf/png/jpg及任意后缀文件，绝对路径含中文、空格、emoji、引号、括号、分号、反引号和$()；'
                    '目录、无落地路径blob/HTTP图片、跨host同名路径、失效fileId/伪造DataTransfer；当前任务输入已有文字、受控dropId/迟到RPC；不运行路径中的命令 |')
    if drop_fixture not in preamble:
        preamble = preamble.replace('\n\n所有用例初始状态为', '\n' + drop_fixture + '\n\n所有用例初始状态为')
    paragraph = ('本版以 JSON 为逐条维护来源，`requirements` 精确关联 `Rxx.x`，`prototype_pages` 关联现有 P01–P18。'
                 '页面关联只表示入口与状态落点；实现边界、待决策项和逐条映射见[需求与用例映射](需求与用例映射.md)。'
                 '修改后运行 `python3 维护用例索引.py --write` 同步本文，再用 `--check` 检查；脚本不执行正式用例。')
    if paragraph not in preamble:
        preamble += '\n\n' + paragraph
    scope_summary = data['scope_summary']
    scope_rule = (f'**R3.3范围：D01、D07均已确认，当前无待用户产品选择。** 总账{scope_summary["total"]}条保留原编号与未执行事实；'
                  f'本期本机适用{scope_summary["current"]}条（含{scope_summary["current_with_deferred_parameters"]}条混合用例的本机分支），'
                  f'{scope_summary["future_only"]}条纯远程功能及混合行的远程参数留后续、未安排M，不计本期通过，也不阻塞本期准出。'
                  '本期包含非本地来源拒绝/身份隔离；OS已解析且位于已授权root内的落地文件路径按本机路径处理，不新增网络连接、挂载或下载。'
                  '`scope/applicability`与逐条范围列是执行依据；R08.9本期仅拒绝非本地来源，R08.12完整远程能力后续。')
    preamble = re.sub(r'\n\n\*\*R3\.3范围：[^\n]*', '', preamble)
    preamble += '\n\n' + scope_rule
    lines = [preamble, '']
    for section, (key, group) in enumerate(data['groups'].items(), 3):
        cases = sorted((c for c in data['cases'] if c['group'] == key), key=lambda c: c['id'])
        lines += [f'## {section}. {group["title"]}', '',
                  f'原型逻辑状态：`{group["prototype"]}`。共 {len(cases)} 条；公共前提见 §2，具体页面及尚缺状态逐条列明。', '',
                  '| 用例／子需求 | 适用范围 | 层级·环境·数据 | 步骤 | 可判定预期与来源 | 原型入口／边界 | 状态 | 证据 |',
                  '| --- | --- | --- | --- | --- | --- | --- | --- |']
        for c in cases:
            caption = dependency_caption(c)
            decision = '；' + caption if caption else ''
            values = [f'**{c["id"]} {c["title"]}**<br>' + '、'.join(c['requirements']), scope_caption(c),
                      c['level'] + '<br>' + '+'.join(c['environments']) + ' / ' + '+'.join(c['data']),
                      c['steps'], c['expected'] + '<br>依据：' + c['source'],
                      '/'.join(c['prototype_pages']) + '；' + c['prototype_status'] + decision,
                      c['status'], '；'.join(map(str, c['evidence'])) if c['evidence'] else '—']
            lines.append('| ' + ' | '.join(cell(v) for v in values) + ' |')
        lines += ['']
    lines += ['## 覆盖统计与准出', '',
              f'当前共 **{len(data["cases"])} 条用例／{len(data["groups"])} 组**。保留原417个稳定编号，R3.2新增Y33–Y40共8条文件拖入终端用例；上下文投递与右侧独立磁盘同步分开，不附加CLI审批/自动还原；R3.1的保存/Office判据及子需求映射继续保留。正式用例仍全部未执行；参数化行须拆成子结果。统计为设计关联数量，不是通过率，也不证明子需求的所有分支均已覆盖。', '',
              f'R3.3本期适用 **{scope_summary["current"]} 条**，纯后续 **{scope_summary["future_only"]} 条**；混合行只按本期分支验收，后续参数另记。102项总账关联保留，本期有{len(data["current_coverage"])}个子需求关联；R08.12远程能力不计本期准出，R08.9只验拒绝非本地来源。', '',
              '| 父需求 | 总账关联用例数 |', '| --- | --- |']
    lines += [f'| {key} | {len(ids)} |' for key, ids in data['parent_coverage'].items()]
    lines += ['', f'已建立 {len(data["coverage"])} 个子需求的用例关联；无关联子项：' + ('、'.join(data['unmapped_requirements']) or '无') + '。未收口的场景与决策见[映射中的缺口账](需求与用例映射.md#仍待收口的覆盖与设计问题)。', '',
              '准出以本期适用矩阵为准：每个纳入功能有安装 App 结果，核心 IO/保存/冲突/权限/PTY 失败项清零，视觉差异逐项处理或明确接受。后续非本期不计通过，也不以其未实现阻塞本期；混合用例需分列本机与后续远程子结果。原型、单元、集成、安装、跨平台、参考观察分别统计；未执行、受阻、待确认不能计为通过。正式用例未执行是开发前的正常状态，不能据此要求先完成生产验收；当前正式开发仍需需求/原型/方案一致且获批准。', '']
    return '\n'.join(lines)


def render_mapping(data):
    summary = data['scope_summary']
    lines = ['# M9 需求、用例与原型映射', '',
             f'依据需求修订：**{data["version"]}**。本次是一致性整理；没有执行或改写任何正式验收结果。', '',
             f'保留原417个稳定用例，R3.2新增Y33–Y40共8条，当前{len(data["cases"])}条；将实际步骤/预期关联到具体子需求和既有 P01–P18 页面。JSON 是唯一逐条维护来源；本文件与测试用例由 `维护用例索引.py --write` 生成。不得通过整组挂全部子需求或重复编号提高覆盖数字。', '',
             f'- {len(data["cases"])} 条用例／{len(data["groups"])} 组；{len(data["coverage"])} 个子需求有至少一条设计关联。',
             '- 全部正式用例仍未执行，实际结果为空，证据数组为空。',
             '- “有设计关联”不等于“所有分支完整覆盖”，也不等于原型已实现或验收通过。',
             '- `prototype` 保留原 PS 逻辑状态，`prototype_pages` 指向真实页面入口；未实现/未核验状态通过状态和备注明确列出。',
             '- R3 局部浏览器/隔离实验保持在原执行记录，未迁成正式用例通过。', '',
             '## 本期与后续适用范围', '',
             data['scope_basis'], '',
             '| 分类 | 条数 | 用例／执行边界 |', '| --- | --- | --- |',
             f'| 本期本机适用总数 | {summary["current"]} | 包括下列本机、拒绝非本地及混合用例的本机分支；全部未执行 |',
             f'| 本机步骤，无远程成功参数 | {summary["current_local_only"]} | 依本机可信根与本期已确认能力执行；其他平台仍按原环境分别验证 |',
             f'| 本期拒绝／隔离非本地来源 | {summary["current_nonlocal_rejection"]} | ' + '、'.join(summary['nonlocal_rejection_case_ids']) + '；不连接远程服务 |',
             f'| 本期用例含后续远程参数 | {summary["current_with_deferred_parameters"]} | ' + '、'.join(summary['mixed_case_ids']) + '；本期只验本机分支，远程参数后续 |',
             f'| 纯后续非本期 | {summary["future_only"]} | ' + '、'.join(summary['future_case_ids']) + '；未安排M，不计本期通过或阻塞 |', '',
             f'总账{summary["total"]}＝本期{summary["current"]}＋纯后续{summary["future_only"]}；混合行不重复计数。总账{len(data["coverage"])}个子需求关联，本期{len(data["current_coverage"])}个；R08.9仅本期拒绝非本地来源，R08.12远程正向能力后续。后续用例的正式status继续为未执行，适用范围不冒充通过或跳过。', '',
             '## 仍待收口的覆盖与设计问题', '',
             '以下是已有用例仍需确定条件/补足设计的部分，不通过删除用例消除缺口，也不要求开发前完成正式安装验收。', '',
             'D01、D07均已由用户确认，当前无待用户产品选择。D02–D06/B01 属于工程方案、实验或参数落实；D08 是证据边界与整体基线评审。远程工程项已随D07留后续，不作为本期闸门。这里引用需求 §7，不另造一套要求用户选择技术协议的清单。', '',
             '| 编号 | 性质 | 当前约束与待办 |', '| --- | --- | --- |']
    lines += [f'| {key} | {cell(data["dependency_kinds"][key])} | {cell(value)} |' for key, value in data['dependencies'].items()]
    lines += ['', '| 子需求／用例 | 当前覆盖边界与下一步 |', '| --- | --- |']
    for gap in data.get('coverage_gaps', []):
        lines.append('| ' + cell('、'.join(gap['requirements']) + '<br>' + '、'.join(gap['cases'])) + ' | ' + cell(gap['note']) + ' |')
    lines += ['', '## 子需求反向索引', '', '| 子需求 | 总账关联 | 本期分支关联 | 后续分支关联 |', '| --- | --- | --- | --- |']
    for req, ids in data['coverage'].items():
        short = lambda values: '、'.join(cid.removeprefix('M9-T-') for cid in values) or '—'
        lines.append(f'| {req} | {short(ids)} | {short(data["current_coverage"].get(req, []))} | {short(data["future_coverage"].get(req, []))} |')
    lines += ['', '无关联子项：' + ('、'.join(data['unmapped_requirements']) or '无') + '。这是关联检查结果，不是完整功能覆盖证明。', '',
              '## 逐条原型与用例映射', '',
              '页面定义见[原型说明 P01–P18](../原型/原型说明与变更.md)。同一用例涉及多个页面时只列与具体步骤有关的入口；服务/平台行为没有可操作页面时标明未实现，不虚构一个已通过的 UI 状态。', '',
              '| 用例 | 子需求 | 适用范围 | 原型入口 | 当前边界／依赖 |', '| --- | --- | --- | --- | --- |']
    for c in sorted(data['cases'], key=lambda c: c['id']):
        details = c['prototype_status'] + '：' + c['prototype_note']
        caption = dependency_caption(c)
        if caption:
            details += ' ' + caption + '。'
        values = [c['id'] + ' ' + c['title'], '、'.join(c['requirements']), scope_caption(c), '/'.join(c['prototype_pages']), details]
        lines.append('| ' + ' | '.join(cell(v) for v in values) + ' |')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--check', action='store_true')
    choice.add_argument('--write', action='store_true')
    args = parser.parse_args()
    original = json.loads(INDEX.read_text())
    data = derive(json.loads(json.dumps(original)))
    rendered = {CASES: render_cases(data), MAP: render_mapping(data)}
    if args.write:
        INDEX.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        for path, content in rendered.items():
            path.write_text(content)
        print(f'Wrote {len(data["cases"])} cases ({data["scope_summary"]["current"]} current / {data["scope_summary"]["future_only"]} future), {len(data["coverage"])} total / {len(data["current_coverage"])} current subrequirements; preserved case results/evidence.')
    else:
        assert data == original, 'Derived JSON coverage/count/group summaries are stale; run --write.'
        for path, content in rendered.items():
            assert path.exists() and path.read_text() == content, f'{path.name} is stale; run --write.'
        print(f'PASS: {len(data["cases"])} unique cases / {len(data["groups"])} groups; {data["scope_summary"]["current"]} current / {data["scope_summary"]["future_only"]} future ({data["scope_summary"]["current_with_deferred_parameters"]} mixed); {len(data["coverage"])} total / {len(data["current_coverage"])} current subrequirements; Markdown/JSON/scope mapping consistent.')


if __name__ == '__main__':
    main()
