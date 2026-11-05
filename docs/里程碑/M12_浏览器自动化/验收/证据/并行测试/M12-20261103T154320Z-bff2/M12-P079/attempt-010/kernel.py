"""One explicitly leased read-only request over stdin; no native load at import."""
import json
import os
import sys
from pathlib import Path
from native_api import Native

def main():
    req=json.loads(sys.stdin.readline());n=Native();rows=[]
    for target in req['targets']:
        pid=target['pid'];before=n.read(pid);row={'pid':pid,'before':before};rows.append(row)
        b,u=before['bsd'],before['rusage']
        canonical=lambda p:str(Path(p).resolve(strict=True)) if isinstance(p,str) else None
        before_path=canonical(before['path']) if before['path'] else None;row['beforeCanonicalPath']=before_path
        live=b['bytes']==136 and b['errno']==0 and b['pid']==pid and b['uid']==os.getuid() and u['rc']==0 and u['errno']==0 and u['startAbstime'] and not u['exitAbstime'] and before['pathRc']>0 and before['pathErrno']==0
        if target.get('knownStartAbstime') and u['startAbstime']!=target['knownStartAbstime']:live=False
        if target.get('expectedPath') and before_path!=canonical(target['expectedPath']):live=False
        if target.get('pathPrefix') and (not before_path or not before_path.startswith(canonical(target['pathPrefix'])+'/')):live=False
        row['verifiedLiveOwnIdentity']=bool(live)
        if live and req.get('coalitions'):
            c=n.coalition_id(pid);after=n.read(pid);row.update(coalition=c,after=after)
            row['stableIdentityAcrossCidRead']=(after['rusage']['rc']==0 and after['rusage']['errno']==0 and after['rusage']['startAbstime']==u['startAbstime'] and all(after['bsd'].get(k)==b[k] for k in ['pid','uid','birthSec','birthUsec']) and canonical(after['path'])==before_path and after['rusage']['exitAbstime']==0 and after['bsd']['bytes']==136 and after['bsd']['errno']==0)
    counters=[]
    if req.get('coalitions'):
        for cid in sorted(set(x['coalition']['resourceId'] for x in rows if x.get('coalition') and x['coalition']['bytes']==40 and x['coalition']['errno']==0 and x['coalition']['resourceId']>0)):
            counters.append(n.coalition_counter(cid))
    census=[]
    if req.get('cloneCensus'):
        sys.path.insert(0,'/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004/private-python')
        import psutil
        prefix=canonical(req['cloneCensus'])+'/Contents/'
        for proc in psutil.process_iter(['pid','exe','uids']):
            try:
                if proc.info['uids'].real==os.getuid() and proc.info['exe'] and canonical(proc.info['exe']).startswith(prefix):census.append(n.read(proc.pid))
            except (psutil.NoSuchProcess,psutil.AccessDenied,FileNotFoundError):continue
    print(json.dumps({'abi':n.abi,'readerPid':os.getpid(),'uid':os.getuid(),'rows':rows,'counters':counters,'cloneCensus':census}),flush=True)

if __name__=='__main__':main()
