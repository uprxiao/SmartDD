"""Contract guards derived from live scope and failure observations; no network."""
from copy import deepcopy
import unittest
from my_work_client import parse_work_page,WorkProtocolError,MyWorkClient


def fixture(mode='bug'):
    data={'mode':mode,'type':'assignedTo','pager':{'recTotal':1,'pageID':1,'recPerPage':1,'pageTotal':1},
          'bugs' if mode=='bug' else 'stories':[{'id':17,'assignedTo':{'account':'test-user'},'status':'active'}]}
    return data


class WorkContractTests(unittest.TestCase):
    def test_sparse_bug_map_keeps_exact_ids(self):
        p=fixture();p['bugs']={'9007199254740997':{'id':'9007199254740997','assignedTo':'test-user'}}
        self.assertEqual(parse_work_page(p,'bug','test-user',1,1).records[0]['id'],'9007199254740997')

    def test_story_plural_and_confirmed_empty_pager(self):
        p=fixture('story');p['stories']=[];p['pager'].update(recTotal=0,pageTotal=0)
        self.assertEqual(parse_work_page(p,'story','test-user',1,1).records,[])

    def test_missing_collection_or_login_is_not_empty(self):
        for p in [{'status':'success','data':{'loginExpired':True}}, {'mode':'story','type':'assignedTo','pager':{'recTotal':0,'pageID':1,'recPerPage':1,'pageTotal':0}}]:
            with self.assertRaises(WorkProtocolError):parse_work_page(p,'story','test-user',1,1)

    def test_unobserved_empty_types_rejected(self):
        for value in (None,False,'',0):
            p=fixture('story');p['stories']=value;p['pager'].update(recTotal=0,pageTotal=0)
            with self.assertRaises(WorkProtocolError):parse_work_page(p,'story','test-user',1,1)

    def test_ignored_pagination_or_inconsistent_total_rejected(self):
        for change in ({'pageID':2},{'recPerPage':20},{'recTotal':3}):
            p=fixture();p['pager'].update(change)
            with self.assertRaises(WorkProtocolError):parse_work_page(p,'bug','test-user',1,1)

    def test_outside_assignee_or_closed_bug_rejected(self):
        for changes in ({'assignedTo':'another-user'},{'status':'closed'}):
            p=fixture();p['bugs'][0].update(changes)
            with self.assertRaises(WorkProtocolError):parse_work_page(p,'bug','test-user',1,1)

    def test_cross_page_duplicates_not_complete(self):
        class Fake:
            def get_v2(self,path,query):
                p=fixture();p['pager'].update(recTotal=2,pageTotal=2,pageID=query['pageID']);return p
        with self.assertRaisesRegex(WorkProtocolError,'Repeated ID'):
            MyWorkClient(Fake(),'test-user').collect('bug',per_page=1)

    def test_changing_inventory_or_budget_not_complete(self):
        class Fake:
            def get_v2(self,path,query):
                p=fixture();total=2 if query['pageID']==1 else 3
                p['pager'].update(recTotal=total,pageTotal=total,pageID=query['pageID']);return p
        with self.assertRaisesRegex(WorkProtocolError,'Inventory changed'):
            MyWorkClient(Fake(),'test-user').collect('bug',per_page=1)
        with self.assertRaisesRegex(WorkProtocolError,'budget exceeded'):
            MyWorkClient(Fake(),'test-user').collect('bug',per_page=1,max_pages=1)


if __name__=='__main__':unittest.main()
