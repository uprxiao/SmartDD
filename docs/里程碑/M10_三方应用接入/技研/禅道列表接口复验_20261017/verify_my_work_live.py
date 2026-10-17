#!/usr/bin/env python3
"""Live read-only pagination, scope and authentication controls for my/work."""
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
from my_work_client import MyWorkClient,WorkProtocolError,parse_work_page


def main():
    for key in ['NO_PROXY','no_proxy']:os.environ[key]=os.environ.get(key,'')+',192.168.106.185'
    report={'schema':'m10-my-work-live-verification-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'businessWrites':0,'credentialsSaved':False,'browserCookieExtracted':False,
            'route':'GET /api.php/v2/my/work','passed':False,'checks':{}}
    client=ZenTaoClient(BASE,timeout=8,retries=0);start=time.monotonic()
    try:
        secret=getpass.getpass('禅道现有密码（隐藏输入）: ')
        client.authenticate(EXPECTED_ACCOUNT,secret);secret=''
        matched=client.get_current_user().get('account')==EXPECTED_ACCOUNT
        report['checks']['expectedAccountVerified']=matched
        if not matched:raise ValueError('Account mismatch')
        work=MyWorkClient(client,EXPECTED_ACCOUNT)
        began=time.monotonic();bugs,pages=work.collect('bug',per_page=1,max_pages=5,max_records=20)
        ids=[str(b['id']) for b in bugs]
        report['bugInventory']={'queryContainsKnownIDsOrProductIDs':False,'pages':pages,'returned':len(ids),
            'completeForWorkScope':True,'allIDsUnique':len(set(ids))==len(ids),
            'matchesCurrentBrowserIDSet':set(ids)=={'79967','79291','79064'},
            'elapsedSeconds':round(time.monotonic()-began,3)}
        report['checks']['bugWorkInventoryMatchesBrowser']=report['bugInventory']['matchesCurrentBrowserIDSet']
        report['checks']['threePagePaginationHonored']=len(pages)==3 and all(p['recPerPage']==1 and p['returned']==1 for p in pages)
        ascending=work.page('bug',per_page=20,order_by='id_asc')
        report['checks']['sortAndRepeatedInventoryAgree']=[str(b['id']) for b in ascending.records]==list(reversed(ids)) and ascending.total==len(ids)
        if bugs:
            payload=client.get_bug_detail_response(bugs[0]['id']);bug=payload.get('bug',payload)
            actions=payload.get('actions',bug.get('actions',[]))
            report['discoveredIDToDetail']={'idMatches':str(bug.get('id'))==ids[0],
                'stepsNonempty':bool(bug.get('steps')),'historyCount':len(actions)}
            report['checks']['discoveredIDToDetail']=report['discoveredIDToDetail']['idMatches'] and report['discoveredIDToDetail']['stepsNonempty']
        report['stage']='story'
        story_payload=client.get_v2('my/work',query={'mode':'story','type':'assignedTo','param':0,'orderBy':'id_desc','recTotal':0,'recPerPage':20,'pageID':1})
        raw_story=story_payload.get('stories')
        report['storySchemaObservation']={'collectionKeyPresent':'stories' in story_payload,
            'collectionType':type(raw_story).__name__,'collectionNull':raw_story is None,
            'collectionFalse':raw_story is False,'collectionEmptyString':raw_story=='',
            'mode':story_payload.get('mode') if story_payload.get('mode') in ('bug','story') else 'unexpected',
            'type':story_payload.get('type') if story_payload.get('type') in ('assignedTo','assignedtome','all') else 'unexpected',
            'pagerNumericValues':{k:v for k,v in story_payload.get('pager',{}).items() if isinstance(v,(bool,int,float))}}
        story_page=parse_work_page(story_payload,'story',EXPECTED_ACCOUNT,1,20)
        stories=story_page.records;story_pages=[{'pageID':story_page.page_id,'recTotal':story_page.total,
            'recPerPage':story_page.per_page,'pageTotal':story_page.page_total,'returned':len(stories),
            'rawCollectionType':story_page.raw_collection_type}]
        report['storyInventory']={'pages':story_pages,'returned':len(stories),'completeForWorkScope':True,
                                  'matchesCurrentBrowserEmptyState':len(stories)==0 and story_pages[0]['recTotal']==0}
        report['checks']['storyEmptyInventoryMatchesBrowser']=report['storyInventory']['matchesCurrentBrowserEmptyState']
        report['stage']='invalid_token_control'
        invalid=ZenTaoClient(BASE,token='m10-intentionally-invalid-token-control',timeout=8,retries=0)
        try:
            invalid.get_v2('my/work',query={'mode':'bug','type':'assignedTo','recTotal':0,'recPerPage':1,'pageID':1})
            report['invalidAuthenticationControl']={'requestRejected':False}
        except Exception as exc:
            status=getattr(exc,'status_code',None)
            report['invalidAuthenticationControl']={'requestRejected':True,'httpStatus':status,'errorType':type(exc).__name__}
        finally:invalid.clear_token()
        report['checks']['invalidTokenRejected']=report['invalidAuthenticationControl'].get('httpStatus') in (401,403)
        report['passed']=all(report['checks'].values())
    except Exception as exc:
        report['errorType']=type(exc).__name__
        if isinstance(exc,WorkProtocolError):report['validationError']=str(exc)
        if getattr(exc,'status_code',None) is not None:report['httpStatus']=exc.status_code
    finally:
        client.clear_token();secret=''
        report['elapsedSeconds']=round(time.monotonic()-start,3)
        report['limits']=['Scope is current-user my/work assignedTo as on the native page; Bug excludes closed. Not an all-history archive.',
                          'The independently observed current account has zero assigned Stories; pagination with nonempty Stories and Story resource fidelity remain untested.',
                          'No task transition, source database access, production App integration, or other platform acceptance.',
                          'IDs are compared after automatic discovery; the query contains neither supplied IDs nor product selection.']
        Path(__file__).with_name('my-work-live-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False))
    raise SystemExit(0 if report['passed'] else 1)


if __name__=='__main__':main()
