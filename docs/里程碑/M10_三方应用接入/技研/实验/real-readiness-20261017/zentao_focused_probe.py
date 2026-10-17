#!/usr/bin/env python3
"""Validate the existing AIS binding's product with bounded full pagination."""
import datetime as dt
import getpass
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
sys.dont_write_bytecode = True
from zentao_read_probe import BASE, EXPECTED_ACCOUNT, SKILL, ZenTaoClient, _make_page
import os
for key in ['NO_PROXY', 'no_proxy']:
    os.environ[key] = os.environ.get(key, '') + ',192.168.106.185'


def account(value):
    if isinstance(value, dict):
        # Observe and record the shape; never use realname as an account.
        return str(value.get('account') or '')
    return str(value or '')


def shape(payload, object_type):
    r = payload.get(object_type, payload) if isinstance(payload, dict) else {}
    spec = r.get('spec')
    spec_text = spec.get('spec', '') if isinstance(spec, dict) else spec
    verify = spec.get('verify', '') if isinstance(spec, dict) else r.get('verify')
    actions = payload.get('actions', r.get('actions', []))
    files = r.get('files', payload.get('files', {}))
    return {'idMatchesRequestedObject': True, 'fieldNames': sorted(r),
            'descriptionNonEmpty': bool(spec_text or r.get('steps') or r.get('description')),
            'specValueType': type(spec).__name__, 'acceptanceNonEmpty': bool(verify),
            'actionsCount': len(actions) if isinstance(actions, (list, dict)) else None,
            'fileCount': len(files) if isinstance(files, (list, dict)) else None}


def main():
    report = {'schema': 'm10-zentao-focused-real-read-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'productSelection': 'case-insensitive AIS name match to existing AIS Microservices project binding',
              'credentialsSaved': False, 'rawBusinessValuesSaved': False, 'businessWrites': 0,
              'productResults': [], 'limits': {'maxProducts': 2, 'maxPagesPerType': 12, 'pageSize': 1000, 'newRequestBudgetSeconds': 180}}
    started = time.monotonic()
    client = ZenTaoClient(BASE, timeout=6, retries=0)
    def budget():
        if time.monotonic() - started > 180:
            raise TimeoutError('New request budget exhausted')
    try:
        password = getpass.getpass('禅道现有密码（隐藏输入）: ')
        client.authenticate(EXPECTED_ACCOUNT, password)
        password = ''
        profile = client.get_current_user()
        report['expectedAccountVerified'] = profile.get('account') == EXPECTED_ACCOUNT
        if not report['expectedAccountVerified']:
            raise ValueError('Expected identity mismatch')
        print('身份已核对；开始限定产品验证。', flush=True)
        products = client.get_products_page(page_id=1, rec_per_page=100)
        matches = [p for p in products.items if 'ais' in str(p.get('name', '')).casefold()]
        report['accessibleProductCount'] = len(products.items)
        report['matchingProductCount'] = len(matches)
        if not 1 <= len(matches) <= 2:
            report['status'] = 'needs_unambiguous_product_selection'
            return report
        for product in matches:
            result = {'productOrdinal': len(report['productResults']) + 1}
            report['productResults'].append(result)
            for plural in ['bugs', 'stories']:
                items = []
                pages = []
                for page_id in range(1, 13):
                    budget()
                    if plural == 'bugs':
                        page = client.get_product_bugs_page(product['id'], page_id=page_id, rec_per_page=1000, branch='all', browse_type='all')
                    else:
                        payload = client.get_v2(f"products/{product['id']}/stories", query={'browseType':'all','orderBy':'id_desc','recPerPage':1000,'pageID':page_id})
                        page = _make_page(payload, item_keys=('stories','items','list','records'), page_hint=page_id, per_page_hint=1000, collection_name='stories')
                    items.extend(page.items)
                    pages.append({'returned':len(page.items),'hasNext':page.has_next,'pager':page.pager.to_dict()})
                    print(f'{plural} 第{page_id}页已读取，返回{len(page.items)}条。', flush=True)
                    if not page.has_next:
                        break
                mine = [r for r in items if account(r.get('assignedTo')) == EXPECTED_ACCOUNT]
                result[plural] = {'pages':pages,'inventoryCompleteWithinSelectedProduct':not page.has_next,
                                   'uniqueReturnedIDs':len({str(r.get('id')) for r in items}),
                                   'assignedToExpectedAccountCount':len(mine),
                                   'assigneeValueType':type(items[0].get('assignedTo')).__name__ if items else None,
                                   'assigneeObjectKeys':sorted(items[0]['assignedTo']) if items and isinstance(items[0].get('assignedTo'),dict) else [],
                                   'details':[]}
                candidates = mine[:1] if plural == 'bugs' else (mine[:1] or items[:5])
                for item in candidates:
                    budget()
                    if plural == 'bugs':
                        payload = client.get_bug_detail_response(item['id'])
                        record = payload.get('bug',payload)
                    else:
                        payload = client.get_v2(f"stories/{item['id']}")
                        record = payload.get('story',payload)
                    entry = shape(payload, 'bug' if plural == 'bugs' else 'story')
                    entry['idMatchesRequestedObject'] = str(record.get('id')) == str(item['id'])
                    entry['assignedToExpectedAccount'] = account(record.get('assignedTo')) == EXPECTED_ACCOUNT
                    result[plural]['details'].append(entry)
                    files = record.get('files', payload.get('files', {}))
                    file_records = list(files.values()) if isinstance(files, dict) else files if isinstance(files,list) else []
                    resource = next((f for f in file_records if isinstance(f,dict) and str(f.get('id','')).isdecimal() and isinstance(f.get('size'),(int,float)) and 0 < f['size'] <= 2*1024*1024),None)
                    if resource:
                        budget()
                        # The existing Skill downloader is used only for the declared
                        # small same-origin file, in an auto-cleaned private directory.
                        with tempfile.TemporaryDirectory(prefix='m10-zentao-resource-') as temp:
                            os.chmod(temp,0o700)
                            downloaded = client.download_file(resource['id'],Path(temp),filename='probe-resource')
                            entry['smallResourceDownload'] = {'status':'downloaded','bytes':downloaded.size,
                                                              'matchesDeclaredSize':downloaded.size==resource['size'],
                                                              'temporaryFilesRemoved':True}
                    if plural == 'bugs' or entry['descriptionNonEmpty']:
                        break
        report['status'] = 'bounded_read_completed'
    except Exception as exc:
        report['status'] = 'partial_or_failed'
        report['errorType'] = type(exc).__name__
        if getattr(exc,'status_code',None) is not None:
            report['httpStatus'] = exc.status_code
    finally:
        client.clear_token()
        report['elapsedSeconds'] = round(time.monotonic()-started,3)
        report['limitations'] = ['Selected AIS products only, not all 13 accessible products.',
                                 'Read-only API PoC, not UI fidelity, state transitions, packaged App or all resource completeness.']
        out=Path(__file__).with_name('zentao-focused-read-result.json')
        out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False),flush=True)
    return report


if __name__ == '__main__':
    main()
