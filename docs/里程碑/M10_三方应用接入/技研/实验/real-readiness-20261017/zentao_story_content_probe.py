#!/usr/bin/env python3
"""Bounded Story content check in products obtained from user-selected Bugs."""
import datetime as dt
import getpass
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import tempfile
import time
from zentao_read_probe import BASE, EXPECTED_ACCOUNT, ZenTaoClient, _make_page


class Text(HTMLParser):
    def __init__(self):super().__init__();self.parts=[]
    def handle_data(self,data):self.parts.append(data)


def nonempty(value):
    if isinstance(value,(list,dict)):
        values=value.values() if isinstance(value,dict) else value
        return any(nonempty(v) for v in values)
    if not isinstance(value,str):return False
    p=Text();p.feed(value)
    return bool(''.join(p.parts).replace('\xa0',' ').strip())


def main():
    for key in ['NO_PROXY','no_proxy']:os.environ[key]=os.environ.get(key,'')+',192.168.106.185'
    base=Path.cwd()/'release/m10-research/live-verification-20261017/zentao-private-targeted/bugs'
    products=[]
    for bug_id in ['79967','79291','79064']:
        b=json.loads((base/('bug-'+bug_id)/'bug.json').read_text())
        pid=str(b.get('product'))
        if pid.isdecimal() and pid not in products:products.append(pid)
    report={'schema':'m10-zentao-story-content-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'selection':'Up to two products identified by the three user-selected Bug details; up to three Story details each.',
            'credentialsSaved':False,'rawBusinessValuesSaved':False,'businessWrites':0,'products':[]}
    start=time.monotonic();client=ZenTaoClient(BASE,timeout=8,retries=0)
    def budget():
        if time.monotonic()-start>120:raise TimeoutError('Read budget exhausted')
    try:
        secret=getpass.getpass('禅道现有密码（隐藏输入）: ')
        client.authenticate(EXPECTED_ACCOUNT,secret);secret=''
        report['expectedAccountVerified']=client.get_current_user().get('account')==EXPECTED_ACCOUNT
        if not report['expectedAccountVerified']:raise ValueError('Identity mismatch')
        found=False
        for pid in products[:2]:
            budget()
            payload=client.get_v2(f'products/{pid}/stories',query={'branch':'all','browseType':'all','orderBy':'id_desc','recPerPage':5,'pageID':1})
            page=_make_page(payload,item_keys=('stories','items','list','records'),page_hint=1,per_page_hint=5,collection_name='stories')
            product={'ordinal':len(report['products'])+1,'returned':len(page.items),'hasNext':page.has_next,'details':[]}
            report['products'].append(product)
            for item in page.items[:3]:
                budget();payload=client.get_v2(f"stories/{item['id']}");r=payload.get('story',payload)
                spec=r.get('spec');description=spec.get('spec') if isinstance(spec,dict) else spec
                verify=spec.get('verify') if isinstance(spec,dict) else r.get('verify')
                actions=payload.get('actions',r.get('actions',[]));files=r.get('files',payload.get('files',[]))
                assigned=r.get('assignedTo');assigned=assigned.get('account') if isinstance(assigned,dict) else assigned
                detail={'idMatchesRequested':str(r.get('id'))==str(item['id']),'fieldNames':sorted(r),
                        'descriptionHasText':nonempty(description),'acceptanceHasText':nonempty(verify),
                        'specValueType':type(spec).__name__,'historyCount':len(actions) if isinstance(actions,(dict,list)) else None,
                        'fileCount':len(files) if isinstance(files,(dict,list)) else None,
                        'assignedToExpectedAccount':assigned==EXPECTED_ACCOUNT}
                product['details'].append(detail)
                if detail['descriptionHasText']:
                    found=True
                    records=list(files.values()) if isinstance(files,dict) else files if isinstance(files,list) else []
                    small=next((f for f in records if isinstance(f,dict) and str(f.get('id','')).isdecimal() and
                                isinstance(f.get('size'),(int,float)) and 0<f['size']<=2*1024*1024),None)
                    if small:
                        budget()
                        with tempfile.TemporaryDirectory(prefix='m10-story-resource-') as temp:
                            os.chmod(temp,0o700)
                            downloaded=client.download_file(small['id'],Path(temp),filename='resource')
                            detail['declaredResourceRead']={'bytes':downloaded.size,'matchesDeclaredSize':downloaded.size==small['size']}
                    break
            if found:break
        report['status']='nonempty_description_read' if found else 'bounded_samples_no_nonempty_description'
    except Exception as exc:
        report.update(status='failed_or_partial',errorType=type(exc).__name__)
        if getattr(exc,'status_code',None) is not None:report['httpStatus']=exc.status_code
    finally:
        client.clear_token();secret=''
        report['elapsedSeconds']=round(time.monotonic()-start,3)
        report['limits']=['Limited first-page Story samples; not proof of the complete assigned Story list.',
                          'No native-page fidelity check or Story state transition.',
                          'No title, description, acceptance criteria, private account or resource name copied to docs.']
        Path(__file__).with_name('zentao-story-content-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
