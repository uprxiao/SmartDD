#!/usr/bin/env python3
"""Empirically probe optional personal routes; SDK minimum is not assumed support."""
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import sys
sys.dont_write_bytecode=True
from zentao_read_probe import BASE,EXPECTED_ACCOUNT,ZenTaoClient,_make_page


def main():
    for k in ['NO_PROXY','no_proxy']:os.environ[k]=os.environ.get(k,'')+',192.168.106.185'
    report={'schema':'m10-zentao-optional-personal-routes-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'sdkDeclaresMinimum':'biz13.5; target biz13.0; optional empirical probe only',
            'credentialsSaved':False,'businessWrites':0,'routes':[]}
    client=ZenTaoClient(BASE,timeout=6,retries=0)
    try:
        secret=getpass.getpass('禅道现有密码（隐藏输入）: ')
        client.authenticate(EXPECTED_ACCOUNT,secret);secret=''
        report['expectedAccountVerified']=client.get_current_user().get('account')==EXPECTED_ACCOUNT
        if not report['expectedAccountVerified']:raise ValueError('Identity mismatch')
        for name in ['bugs','stories']:
            r={'path':'/api.php/v2/my/'+name,'browseType':'assignedTo'}
            try:
                payload=client.get_v2('my/'+name,query={'browseType':'assignedTo','recPerPage':100,'pageID':1,'orderBy':'id_desc'})
                page=_make_page(payload,item_keys=(name,'items','list','records'),page_hint=1,per_page_hint=100,collection_name=name)
                r.update(status='read',returned=len(page.items),hasNext=page.has_next,pager=page.pager.to_dict())
                r['everyReturnedObjectAssignedToExpectedAccount']=all((x.get('assignedTo',{}).get('account') if isinstance(x.get('assignedTo'),dict) else x.get('assignedTo'))==EXPECTED_ACCOUNT for x in page.items)
                if name=='bugs' and page.items:
                    source=client.get_bug_detail_response(page.items[0]['id']);bug=source.get('bug',source)
                    r['sampleDetail']={'idMatches':str(bug.get('id'))==str(page.items[0]['id']),
                                       'stepsPresent':bool(bug.get('steps')),
                                       'actionsPresent':bool(source.get('actions') or bug.get('actions')),
                                       'filesPresent':bool(bug.get('files') or source.get('files'))}
            except Exception as exc:
                r.update(status='not_verified',errorType=type(exc).__name__)
                if getattr(exc,'status_code',None) is not None:r['httpStatus']=exc.status_code
            report['routes'].append(r)
    except Exception as exc:
        report['errorType']=type(exc).__name__
    finally:
        client.clear_token()
        report['limits']=['Successful reads do not imply support on every biz13.0 deployment.',
                          'First page only; any hasNext=true is incomplete; no unsupported empty response is treated as no work.']
        p=Path(__file__).with_name('zentao-personal-routes-result.json');p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
