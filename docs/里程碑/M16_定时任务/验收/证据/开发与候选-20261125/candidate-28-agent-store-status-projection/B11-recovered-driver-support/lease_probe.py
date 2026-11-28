#!/usr/bin/env python3
"""Bind only the explicit private runner, child and coordinator process identities."""
import sys, os, json, pathlib
from own_scope_native import ScopeNative
from coalition_accounting import cid_valid

def exact(native,pid,expected):
 first=native.bsd(pid);cid=native.coalition_id(pid)
 assert native.bsd_ok(first,pid) and cid_valid(cid,pid)
 rc,err,path=native.path(pid)
 after=native.bsd(pid);again=native.coalition_id(pid)
 assert rc>0 and not err and path==expected
 assert native.bsd_ok(after,pid) and native.born(first)==native.born(after)
 assert cid_valid(again,pid) and cid['resourceId']==again['resourceId']
 # Keep the C12 driver contract: exact prepared runner/driver path and birth.
 return {'pid':pid,'before':{'bsd':first,'path':path},'after':{'bsd':after,'path':path},'resourceId':cid['resourceId']}

def main():
 assert len(sys.argv)==6
 wrapper,driver,coordinator=map(int,sys.argv[1:4]);exe,node=map(str,sys.argv[4:])
 base=pathlib.Path(__file__).resolve().parent
 assert exe.startswith(str(base)+'/cohort-') and exe.endswith('/Contents/MacOS/WillYouB11AcceptanceRunner')
 assert pathlib.Path(node).resolve().name=='node'
 n=ScopeNative();rows=[exact(n,wrapper,exe),exact(n,driver,node),exact(n,coordinator,node)]
 assert rows[1]['before']['bsd']['ppid']==wrapper
 cid=rows[0]['resourceId'];assert cid==rows[1]['resourceId'] and cid!=rows[2]['resourceId']
 print(json.dumps({'rows':rows[:2],'resourceId':cid,'externalResourceIds':[rows[2]['resourceId']],'probeBoundary':'exact private wrapper and driver share an exclusive resource CID, distinct from coordinator'}))

if __name__=='__main__':main()
