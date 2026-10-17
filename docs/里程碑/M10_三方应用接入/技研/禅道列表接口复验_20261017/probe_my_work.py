#!/usr/bin/env python3
"""Test source-derived my/work routes using the existing REST token in memory."""
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import sys
import time

sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'实验/real-readiness-20261017'))
from zentao_read_probe import BASE,EXPECTED_ACCOUNT,ZenTaoClient


def main():
    for key in ['NO_PROXY','no_proxy']:os.environ[key]=os.environ.get(key,'')+',192.168.106.185'
    report={'schema':'m10-source-derived-my-work-probe-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'targetVersion':'biz13.0','authentication':'Existing REST Token header; no browser cookie extraction',
            'credentialsSaved':False,'businessWrites':0,'routes':[]}
    client=ZenTaoClient(BASE,timeout=8,retries=0)
    start=time.monotonic()
    try:
        secret=getpass.getpass('禅道现有密码（隐藏输入）: ')
        client.authenticate(EXPECTED_ACCOUNT,secret);secret=''
        report['expectedAccountVerified']=client.get_current_user().get('account')==EXPECTED_ACCOUNT
        if not report['expectedAccountVerified']:raise ValueError('Account mismatch')
        for mode in ['bug','story']:
            for transport in ['page_json','rest_v2_work']:
                query={'mode':mode,'type':'assignedTo','param':0,'orderBy':'id_desc','recTotal':0,'recPerPage':20,'pageID':1}
                path=f'my-work-{mode}-assignedTo-0-id_desc-0-20-1.json' if transport=='page_json' else 'my/work'
                result={'mode':mode,'transport':transport,'path':path,'query':{} if transport=='page_json' else query}
                report['routes'].append(result)
                began=time.monotonic()
                try:
                    payload=client.request_json('GET',path,query=None if transport=='page_json' else query,version=None if transport=='page_json' else 'v2')
                    result['topLevelType']=type(payload).__name__
                    result['topLevelKeys']=sorted(payload) if isinstance(payload,dict) else []
                    data=payload
                    for _ in range(3):
                        if isinstance(data,dict) and 'data' in data:
                            value=data['data']
                            data=json.loads(value) if isinstance(value,str) else value
                        else:break
                    result['dataType']=type(data).__name__
                    result['dataKeys']=sorted(data) if isinstance(data,dict) else []
                    records=data.get('bugs' if mode=='bug' else 'stories') if isinstance(data,dict) else None
                    if isinstance(records,dict):records=list(records.values())
                    result['collectionPresent']=isinstance(records,list)
                    if isinstance(records,list):
                        result['returnedCount']=len(records)
                        ids=[str(r.get('id')) for r in records if isinstance(r,dict)]
                        result['idSetMatchesObservedBrowser']=set(ids)==({'79967','79291','79064'} if mode=='bug' else set())
                        def account(v):return v.get('account') if isinstance(v,dict) else v
                        result['allReturnedAssignedToExpectedAccount']=all(account(r.get('assignedTo'))==EXPECTED_ACCOUNT for r in records)
                    pager=data.get('pager') if isinstance(data,dict) else None
                    if isinstance(pager,str):
                        try:pager=json.loads(pager)
                        except (TypeError,ValueError):pager=None
                    result['pagerType']=type(pager).__name__
                    if isinstance(pager,dict):result['pagerNumericValues']={k:v for k,v in pager.items() if isinstance(v,(int,float,bool))}
                    result['status']='read'
                except Exception as exc:
                    result.update(status='not_verified',errorType=type(exc).__name__)
                    if getattr(exc,'status_code',None) is not None:result['httpStatus']=exc.status_code
                result['elapsedSeconds']=round(time.monotonic()-began,3)
    except Exception as exc:
        report['errorType']=type(exc).__name__
    finally:
        client.clear_token();secret=''
        report['elapsedSeconds']=round(time.monotonic()-start,3)
        report['limits']=['Initial route and schema probe, not a full pager/negative-control check.',
                          'Browser comparison is the independently observed current page: Bug total3, IDs79967/79291/79064, Story total0.',
                          'No returned payload, session identifier, token or business field value is persisted.']
        Path(__file__).with_name('my-work-route-probe-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
