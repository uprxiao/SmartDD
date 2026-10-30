#!/usr/bin/env python3
"""Run the existing Skill and bounded Bug/Story reads. Credentials stay in memory."""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
SKILL = Path('/Users/liubu/.codex/skills/export-zentao-bugs').resolve()
sys.path.insert(0, str(SKILL / 'scripts'))
from zentao_client import ZenTaoClient, _make_page  # existing tested pagination parser

BASE = 'http://192.168.106.185/biz'
BINDING = Path.home() / '.codex/config/resolve-zentao-bug-round/bindings/ultrasafe-ais-ms.json'
_binding = json.loads(BINDING.read_text()).get('zentao', {})
if str(_binding.get('base_url', '')).rstrip('/') != BASE:
    raise ValueError('Existing binding does not match the reviewed site')
EXPECTED_ACCOUNT = str(_binding.get('username') or '')
if not EXPECTED_ACCOUNT:
    raise ValueError('Existing binding has no expected account')


def field_shape(payload, record_key):
    record = payload.get(record_key, payload) if isinstance(payload, dict) else {}
    if not isinstance(record, dict):
        record = {}
    actions = payload.get('actions', record.get('actions')) if isinstance(payload, dict) else None
    files = record.get('files', payload.get('files') if isinstance(payload, dict) else None)
    return {'objectPresent': bool(record),
            'fieldNames': sorted(str(k) for k in record),
            'descriptionPresent': bool(record.get('steps') or record.get('spec') or record.get('description')),
            'acceptanceCriteriaPresent': bool(record.get('verify') or record.get('verifyCriteria')),
            'historyPresent': isinstance(actions, (dict, list)),
            'historyCount': len(actions) if isinstance(actions, (dict, list)) else None,
            'filesFieldPresent': files is not None,
            'filesCount': len(files) if isinstance(files, (dict, list)) else None}


def run(secret, mode='password', known_story_id=''):
    started = time.monotonic()
    # Keep this fixed authorized internal destination direct, matching the old
    # connector, instead of inheriting the shell's HTTP proxy for private IPs.
    for key in ['NO_PROXY', 'no_proxy']:
        previous = os.environ.get(key, '')
        os.environ[key] = previous + (',' if previous else '') + '192.168.106.185'
    report = {'schema': 'm10-zentao-authenticated-read-poc-v1',
              'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'baseUrl': BASE,
              'expectedAccountFromExistingBinding': True, 'authenticationMode': mode,
              'businessWrites': 0, 'rawBusinessDataSaved': False, 'credentialsSaved': False,
              'directInternalTarget': True,
              'scope': 'Existing Skill probe plus bounded products/Bug/Story read; no all-data export.',
              'reads': [], 'limitations': []}
    client = ZenTaoClient(BASE, token=secret if mode == 'token' else None, timeout=6, retries=0)
    try:
        report['stage'] = 'authentication'
        if mode != 'token':
            token = client.authenticate(EXPECTED_ACCOUNT, secret)
        else:
            token = secret
        report['stage'] = 'identity'
        profile = client.get_current_user()
        if profile.get('account') != EXPECTED_ACCOUNT:
            report['authentication'] = 'account_mismatch'
            return report
        report['authentication'] = 'verified_expected_account'
        report['stage'] = 'existing_skill_probe'
        # Execute the original Skill probe unmodified. Capture its private account/product
        # details in memory, and only persist a whitelist of capability flags/counts.
        env = {k: v for k, v in os.environ.items() if not k.startswith('ZENTAO_')}
        env.update({'ZENTAO_TOKEN': token, 'PYTHONDONTWRITEBYTECODE': '1', 'NO_PROXY': '*', 'no_proxy': '*'})
        cmd = [sys.executable, str(SKILL / 'scripts/probe_zentao.py'), '--base-url', BASE,
               '--username', EXPECTED_ACCOUNT, '--version-hint', '企业版 13.0', '--timeout', '6', '--retries', '0']
        try:
            completed = subprocess.run(cmd, env=env, capture_output=True, timeout=45, text=True)
            original = json.loads(completed.stdout)
            report['existingSkillProbe'] = {'executed': True, 'exitCode': completed.returncode,
                                            'ok': original.get('ok'), 'capabilities': original.get('capabilities'),
                                            'productCount': len(original.get('products', [])),
                                            'warningCount': len(original.get('warnings', [])),
                                            'errorCount': len(original.get('errors', [])),
                                            'sourceSha256': hashlib.sha256((SKILL / 'scripts/probe_zentao.py').read_bytes()).hexdigest()}
        except Exception as exc:
            report['existingSkillProbe'] = {'executed': True, 'errorType': type(exc).__name__}
        report['stage'] = 'product_and_object_reads'
        products = client.get_products_page(page_id=1, rec_per_page=100)
        report['productsRead'] = {'returned': len(products.items), 'hasMorePages': products.has_next,
                                   'inspectedProductLimit': 5}
        bug_candidates = []
        story_candidates = []
        for product in products.items[:5]:
            pid = product.get('id')
            if not str(pid).isdecimal():
                continue
            for object_type in ['bugs', 'stories']:
                entry = {'operation': f'product_{object_type}_list', 'productOrdinal': len(report['reads']) // 2 + 1,
                         'maxPages': 3, 'pageSize': 100, 'pages': []}
                all_items = []
                try:
                    for page_id in range(1, 4):
                        if object_type == 'bugs':
                            page = client.get_product_bugs_page(pid, branch='all', browse_type='all',
                                                                page_id=page_id, rec_per_page=100)
                        else:
                            payload = client.get_v2(f'products/{pid}/stories', query={
                                'branch': 'all', 'browseType': 'all', 'orderBy': 'id_desc',
                                'recPerPage': 100, 'pageID': page_id})
                            page = _make_page(payload, item_keys=('stories', 'items', 'list', 'records'),
                                              page_hint=page_id, per_page_hint=100, collection_name='stories')
                        all_items.extend(page.items)
                        entry['pages'].append({'returned': len(page.items), 'hasNext': page.has_next,
                                                'pager': page.pager.to_dict()})
                        if not page.has_next:
                            break
                    entry['status'] = 'read'
                    entry['boundedScopeComplete'] = not page.has_next
                    def assigned_account(value):
                        return value.get('account') if isinstance(value, dict) else value
                    mine = [r for r in all_items if assigned_account(r.get('assignedTo')) == EXPECTED_ACCOUNT]
                    entry['assignedToExpectedAccountCount'] = len(mine)
                    entry['listFieldNames'] = sorted(all_items[0]) if all_items else []
                    if object_type == 'bugs':
                        bug_candidates.extend(mine)
                    else:
                        # User explicitly asked to validate Story, including a nonempty
                        # readable sample. Keep whether it is personally assigned clear.
                        story_candidates.extend(mine or all_items[:1])
                except Exception as exc:
                    entry.update({'status': 'failed', 'errorType': type(exc).__name__})
                report['reads'].append(entry)
        if bug_candidates:
            bug_id = bug_candidates[0].get('id')
            payload = client.get_bug_detail_response(bug_id)
            report['bugDetail'] = {'status': 'read', 'sampleAssignedToExpectedAccount': True,
                                    **field_shape(payload, 'bug')}
        else:
            report['bugDetail'] = {'status': 'not_executed_no_assigned_sample_in_bounded_inventory'}
        story_id = known_story_id or (story_candidates[0].get('id') if story_candidates else '')
        if str(story_id).isdecimal():
            payload = client.get_v2(f'stories/{story_id}')
            report['storyDetail'] = {'status': 'read', 'sampleSelection': 'explicit_user_id' if known_story_id else 'first_authorized_list_sample',
                                      **field_shape(payload, 'story')}
        else:
            report['storyDetail'] = {'status': 'not_executed_no_nonempty_sample'}
        report['limitations'] += ['At most first 5 products and 3 pages each; not a claim of all assigned objects.',
                                   'Object field presence is not page-by-page content fidelity.',
                                   'Attachments/inline resource binary downloads and external state transitions not executed.']
    except Exception as exc:
        report['errorType'] = type(exc).__name__
        if getattr(exc, 'status_code', None) is not None:
            report['httpStatus'] = exc.status_code
        report.setdefault('authentication', 'failed_or_not_verified')
    finally:
        client.clear_token()
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    return report


if __name__ == '__main__':
    import argparse
    import getpass
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['password', 'token'], default='password')
    ap.add_argument('--story-id', default='')
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    secret = getpass.getpass('禅道现有密码或Token（隐藏输入）: ')
    result = run(secret, args.mode, args.story_id)
    secret = ''
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))
