#!/usr/bin/env python3
"""Validate optional server filtering with a negative control before trusting it."""
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import sys
import time
sys.dont_write_bytecode=True
from zentao_read_probe import BASE,EXPECTED_ACCOUNT,ZenTaoClient,_make_page


def main():
    for k in ['NO_PROXY','no_proxy']:os.environ[k]=os.environ.get(k,'')+',192.168.106.185'
    client=ZenTaoClient(BASE,timeout=6,retries=0)
    report={'schema':'m10-zentao-filter-probe-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'credentialsSaved':False,'businessWrites':0,'queryEncoding':'PHP deepObject filters[0][field/operator/value/join/group]',
            'products':[]}
    start=time.monotonic()
    def request(pid,kind,who=None,limit=100):
        if time.monotonic()-start>180:raise TimeoutError('Probe budget')
        q={'branch':'all','browseType':'bysearch' if who is not None else 'all','recPerPage':limit,'pageID':1,'orderBy':'id_desc'}
        if who is not None:q.update({'filters[0][field]':'assignedTo','filters[0][operator]':'=','filters[0][value]':who,'filters[0][join]':'and','filters[0][group]':1,'groupJoin':'and'})
        raw=client.get_v2(f'products/{pid}/{kind}',query=q)
        return _make_page(raw,item_keys=(kind,'items','list','records'),page_hint=1,per_page_hint=limit,collection_name=kind)
    def owner(value):return value.get('account') if isinstance(value,dict) else value
    try:
        secret=getpass.getpass('禅道现有密码（隐藏输入）: ')
        client.authenticate(EXPECTED_ACCOUNT,secret);secret=''
        report['expectedAccountVerified']=client.get_current_user().get('account')==EXPECTED_ACCOUNT
        if not report['expectedAccountVerified']:raise ValueError('Identity mismatch')
        products=client.get_products_page(page_id=1,rec_per_page=100)
        report['productRosterComplete']=not products.has_next
        control_product=None
        for p in products.items:
            baseline=request(p['id'],'bugs',limit=1)
            if baseline.items:
                control_product=p['id'];break
        if control_product is None:
            report['status']='no_populated_control';return
        negative=request(control_product,'bugs','__willyou_m10_nonexistent_account__',limit=1)
        report['negativeControl']={'unfilteredNonempty':True,'filteredReturned':len(negative.items),'hasNext':negative.has_next}
        if negative.items or negative.has_next:
            report['status']='filter_not_verified_do_not_trust_personal_empty';return
        for ordinal,p in enumerate(products.items,1):
            r={'productOrdinal':ordinal};report['products'].append(r)
            for kind in ['bugs','stories']:
                page=request(p['id'],kind,EXPECTED_ACCOUNT)
                rows=page.items
                r[kind]={'returned':len(rows),'hasNext':page.has_next,
                         'everyReturnedObjectAssignedToExpectedAccount':all(owner(x.get('assignedTo'))==EXPECTED_ACCOUNT for x in rows)}
                if not r[kind]['everyReturnedObjectAssignedToExpectedAccount']:
                    report['status']='positive_filter_ignored_or_wrong';return
                if kind=='bugs' and rows and 'bugDetail' not in report:
                    raw=client.get_bug_detail_response(rows[0]['id']);bug=raw.get('bug',raw)
                    report['bugDetail']={'idMatches':str(bug.get('id'))==str(rows[0]['id']),
                                         'assignedToExpectedAccount':owner(bug.get('assignedTo'))==EXPECTED_ACCOUNT,
                                         'stepsPresent':bool(bug.get('steps')),
                                         'historyCount':len(raw.get('actions',bug.get('actions',[]))),
                                         'fileCount':len(bug.get('files',raw.get('files',{})))}
            print(f'本人过滤已核对{ordinal}/{len(products.items)}个产品。',flush=True)
        report['status']='bounded_filter_validation_completed'
    except Exception as exc:
        report.update(status='not_verified',errorType=type(exc).__name__)
        if getattr(exc,'status_code',None) is not None:report['httpStatus']=exc.status_code
    finally:
        client.clear_token()
        report['elapsedSeconds']=round(time.monotonic()-start,3)
        report['limits']=['Optional generic filtering is not assumed supported from SDK; negative/positive controls required.',
                          'Any hasNext=true is incomplete; no write or state transition.']
        p=Path(__file__).with_name('zentao-filter-result.json');p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
