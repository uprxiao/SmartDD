"""Research-only adapter for the observed biz13.0 my/work REST controller.

This is an independent client implementation, not copied ZenTao PHP. The caller
supplies an authenticated existing ZenTaoClient and the verified account.
"""
from dataclasses import dataclass
import math
import time


class WorkProtocolError(ValueError):
    pass


@dataclass
class WorkPage:
    records: list
    total: int
    page_id: int
    per_page: int
    page_total: int
    raw_collection_type: str


def _integer(value,name,minimum=0):
    if isinstance(value,bool) or not isinstance(value,int) or value<minimum:
        raise WorkProtocolError('Invalid pager '+name)
    return value


def parse_work_page(payload,mode,expected_account,requested_page,requested_size):
    if mode not in ('bug','story') or not expected_account:
        raise WorkProtocolError('Explicit supported mode and verified account required')
    if not isinstance(payload,dict):raise WorkProtocolError('Expected object')
    if payload.get('mode')!=mode or payload.get('type')!='assignedTo':
        raise WorkProtocolError('Response scope mismatch or login response')
    pager=payload.get('pager')
    if not isinstance(pager,dict):raise WorkProtocolError('Missing pager')
    total=_integer(pager.get('recTotal'),'recTotal')
    page_id=_integer(pager.get('pageID'),'pageID',1)
    per_page=_integer(pager.get('recPerPage'),'recPerPage',1)
    page_total=_integer(pager.get('pageTotal'),'pageTotal')
    if page_id!=requested_page or per_page!=requested_size:
        raise WorkProtocolError('Server did not honor requested pagination')
    if page_total!=math.ceil(total/per_page):raise WorkProtocolError('Inconsistent page total')
    key='bugs' if mode=='bug' else 'stories'
    if key not in payload:raise WorkProtocolError('Missing collection')
    raw=payload[key]
    if isinstance(raw,list):records=raw
    elif isinstance(raw,dict):records=list(raw.values())
    else:raise WorkProtocolError('Invalid collection')
    if len(records)>per_page or len(records)>total:raise WorkProtocolError('Invalid page size')
    ids=[]
    for r in records:
        if not isinstance(r,dict):raise WorkProtocolError('Invalid record')
        record_id=str(r.get('id'))
        if not record_id.isdecimal() or int(record_id)<=0:raise WorkProtocolError('Invalid stable ID')
        ids.append(record_id)
        account=r.get('assignedTo')
        if isinstance(account,dict):account=account.get('account')
        if account!=expected_account:raise WorkProtocolError('Unexpected assignee')
        if mode=='bug' and r.get('status')=='closed':raise WorkProtocolError('Closed Bug outside work scope')
    if len(ids)!=len(set(ids)):raise WorkProtocolError('Duplicate IDs within page')
    return WorkPage(records,total,page_id,per_page,page_total,type(raw).__name__)


class MyWorkClient:
    def __init__(self,authenticated_client,verified_account):
        self.client=authenticated_client
        self.account=verified_account

    def page(self,mode,page_id=1,per_page=20,order_by='id_desc'):
        if mode not in ('bug','story') or order_by not in ('id_desc','id_asc'):
            raise ValueError('Unsupported mode or order')
        _integer(page_id,'pageID',1);_integer(per_page,'recPerPage',1)
        if per_page>1000:raise ValueError('Page size exceeds budget')
        payload=self.client.get_v2('my/work',query={'mode':mode,'type':'assignedTo','param':0,
            'orderBy':order_by,'recTotal':0,'recPerPage':per_page,'pageID':page_id})
        return parse_work_page(payload,mode,self.account,page_id,per_page)

    def collect(self,mode,per_page=20,max_pages=20,max_records=2000,budget_seconds=120):
        if max_pages<1 or max_records<0 or budget_seconds<=0:raise ValueError('Explicit positive budget required')
        start=time.monotonic();records=[];pages=[];seen=set();total=None
        page_id=1
        while page_id<=max_pages:
            if time.monotonic()-start>budget_seconds:raise TimeoutError('Collection time budget exhausted')
            page=self.page(mode,page_id,per_page)
            if total is None:total=page.total
            if page.total!=total:raise WorkProtocolError('Inventory changed during pagination')
            if total>max_records:raise WorkProtocolError('Collection record budget exceeded')
            pages.append({'pageID':page.page_id,'recTotal':page.total,'recPerPage':page.per_page,
                          'pageTotal':page.page_total,'returned':len(page.records),
                          'rawCollectionType':page.raw_collection_type})
            for record in page.records:
                record_id=str(record['id'])
                if record_id in seen:raise WorkProtocolError('Repeated ID across pages')
                seen.add(record_id);records.append(record)
            if page_id>=max(1,page.page_total):
                if len(seen)!=total:raise WorkProtocolError('Collected ID count differs from total')
                return records,pages
            if not page.records:raise WorkProtocolError('Empty page before final page')
            page_id+=1
        raise WorkProtocolError('Page budget exceeded; inventory incomplete')
