"""Pure-data tests; no ctypes library loads or OS/process sampling."""
from copy import deepcopy
import json
from pathlib import Path
from coalition_accounting import CoalitionTracker
from coalition_judge import adjudicate

class Fake:
    uid=501;abi={'bsdSize':136,'v2Size':160,'numer':125,'denom':3}
    def __init__(self):self.t=100;self.c=0;self.bad=None
    def read(self,pid):
        self.t+=1
        return {'pid':pid,'startReadNs':self.t,'endReadNs':self.t,'bsd':{'pid':pid,'uid':501,'bytes':136,'errno':0,'birthSec':10,'birthUsec':pid},'rusage':{'rc':0,'errno':0,'exitAbstime':0,'startAbstime':pid*10},'path':'/owned/'+str(pid),'pathRc':10,'pathErrno':0}
    def coalition_id(self,pid):
        self.t+=1
        r={'pid':pid,'bytes':40,'errno':0,'startNs':self.t,'endNs':self.t,'resourceId':719,'jetsamId':720,'reserved':[0,0,0]}
        if self.bad=='permission':r['errno']=1
        if self.bad=='membership':r['resourceId']=721
        return r
    def coalition_counter(self,cid):
        self.t+=1;self.c+=1
        r={'resourceId':cid,'startNs':self.t,'endNs':self.t,'rc':0,'errno':0,'prefixBytes':32,'tasks_started':30+self.c,'tasks_exited':20+self.c,'time_nonempty':1000+self.c,'cpu_time':24000000*self.c}
        if self.bad=='counter':r['errno']=1
        if self.bad=='regression':r['cpu_time']=0
        return r

def fixture():
    n=Fake();anchors={}
    for pid in [1,2]:anchors[pid]={'identity':str(pid)+':'+str(pid*10),'role':'app' if pid==1 else 'fixed-daemon','birth':{'pid':pid,'startAbstime':pid*10,'birthSec':10,'birthUsec':pid},'path':'/owned/'+str(pid)}
    tracker=CoalitionTracker(n,anchors);events=[]
    for req,phase in [(1,'initial'),(2,'capture'),(3,'final')]:
        c=tracker.capture(phase)
        # Tracker clock uses real Python monotonic only; raw API counter windows are deterministic mock data.
        c['startNs']=1;c['endNs']=10000
        events.append({'kind':'cpu-initialized' if req==1 else 'cpu-upper-sample','requestId':req,'final':phase=='final','abi':n.abi,'anchors':{str(k):v for k,v in anchors.items()},'coalition':c,'gaps':[]})
    raw={'host':{'uid':501},'measurementStartMonoNs':'1000000000','measurementEndMonoNs':'1801000000000','cpuCollector':{'exchanges':[{'requestId':1,'type':'init','startDriverMonoNs':'100','endDriverMonoNs':'200'},{'requestId':3,'type':'sample','final':True,'startDriverMonoNs':'1801000000100','endDriverMonoNs':'1801000000200'}]}}
    analysis={'measuredCompleteIdleSeconds':1700,'idleWeightedOneCorePercent':0.5}
    return n,tracker,events,raw,analysis

def main():
    results=[]
    def check(name,ok):
        if not ok:raise AssertionError(name)
        results.append({'name':name,'pass':True})
    _,_,e,r,a=fixture();good=adjudicate(e,r,a)
    check('healthy-deduplicates-two-anchors-one-cid',good['scopeApproved'] and len(good['coalitionDeltaTicksByCid'])==1 and good['coalitionUpperCpuSeconds']==2)
    mixed=deepcopy(e)
    for x in mixed:
        c=x['coalition'];c['bindings']['2']=721;c['resourceIds']=[719,721];c['anchorReads'][1]['coalition']['resourceId']=721;second=deepcopy(c['counters'][0]);second['resourceId']=721;second['cpu_time']*=2;c['counters'].append(second)
    mixed_result=adjudicate(mixed,r,a);check('multiple-app-resource-cids-summed-without-collector-samecid-rule',mixed_result['scopeApproved'] and mixed_result['coalitionUpperCpuSeconds']==6)
    mutations={
      'missing-init':lambda e,r,a:e.pop(0),
      'duplicate-init':lambda e,r,a:e.insert(0,deepcopy(e[0])),
      'missing-final':lambda e,r,a:e.pop(),
      'duplicate-final':lambda e,r,a:e.append(deepcopy(e[-1])),
      'CID-changed':lambda e,r,a:e[-1]['coalition']['bindings'].__setitem__('1',721),
      'CID-row-changed':lambda e,r,a:e[-1]['coalition']['anchorReads'][0]['coalition'].__setitem__('resourceId',721),
      'duplicate-CID-counter':lambda e,r,a:e[-1]['coalition']['counters'].append(deepcopy(e[-1]['coalition']['counters'][0])),
      'counter-permission':lambda e,r,a:e[-1]['coalition']['counters'][0].__setitem__('errno',1),
      'CID-permission':lambda e,r,a:e[0]['coalition']['anchorReads'][0]['coalition'].__setitem__('errno',1),
      'wrong-UID':lambda e,r,a:e[0]['coalition']['anchorReads'][0]['before']['bsd'].__setitem__('uid',0),
      'birth-reused':lambda e,r,a:e[-1]['coalition']['anchorReads'][0]['after']['rusage'].__setitem__('startAbstime',999),
      'anchor-path':lambda e,r,a:e[-1]['coalition']['anchorReads'][0]['after'].__setitem__('path','/foreign'),
      'counter-decreased':lambda e,r,a:e[-1]['coalition']['counters'][0].__setitem__('cpu_time',0),
      'counter-float':lambda e,r,a:e[-1]['coalition']['counters'][0].__setitem__('cpu_time',1.5),
      'counter-negative':lambda e,r,a:e[-1]['coalition']['counters'][0].__setitem__('cpu_time',-1),
      'counter-structure':lambda e,r,a:e[-1]['coalition']['counters'][0].__setitem__('prefixBytes',8),
      'timebase-changed':lambda e,r,a:e[-1]['abi'].__setitem__('denom',0),
      'zero-idle':lambda e,r,a:a.__setitem__('measuredCompleteIdleSeconds',0),
      'nan-idle':lambda e,r,a:a.__setitem__('measuredCompleteIdleSeconds','nan'),
      'overlong-idle':lambda e,r,a:a.__setitem__('measuredCompleteIdleSeconds',1900),
      'short-runtime':lambda e,r,a:r.__setitem__('measurementEndMonoNs','10000000000'),
      'baseline-after-clock0':lambda e,r,a:r['cpuCollector']['exchanges'][0].__setitem__('endDriverMonoNs','2000000000'),
      'final-before-end':lambda e,r,a:r['cpuCollector']['exchanges'][-1].__setitem__('startDriverMonoNs','1700000000000'),
      'reference-API-gap':lambda e,r,a:e[-1]['gaps'].append({'code':'error'}),
      'negative-native-time':lambda e,r,a:e[-1]['coalition']['counters'][0].__setitem__('startNs',-1),
    }
    for name,fn in mutations.items():
        ee,rr,aa=deepcopy((e,r,a));fn(ee,rr,aa);bad=adjudicate(ee,rr,aa)
        check('reject-'+name,not bad['scopeApproved'] and 'below-original-five' not in bad['decision'])
    for name,kw in [('proof-hash',{'proof_ok':False}),('raw-carrier-mismatch',{'raw_matches':False}),('reference-api-error',{'reference_api_ok':False})]:
        bad=adjudicate(e,r,a,**kw);check('reject-'+name,not bad['scopeApproved'])
    ee,rr,aa=deepcopy((e,r,a));ee[-1]['coalition']['counters'][0]['cpu_time']+=24000000*200
    high=adjudicate(ee,rr,aa);check('upper-high-is-inconclusive-not-product-red',high['scopeApproved'] and high['decision']=='coalition-upper-not-below-five-inconclusive')
    aa['idleWeightedOneCorePercent']=59
    check('own59-still-product-red',adjudicate(ee,rr,aa)['decision']=='original-own-lowerbound-fails')
    for bad in ['permission','membership','counter','regression']:
        n,t,_,_,_=fixture();n.bad=bad
        try:t.capture('capture')
        except RuntimeError:check('runtime-failclosed-'+bad,True)
        else:check('runtime-failclosed-'+bad,False)
    out={'pureDataOnly':True,'nativeLoaded':False,'AppStarted':False,'checks':results,'passed':len(results)}
    (Path(__file__).parent/'coalition-model-checks.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({'passed':len(results),'nativeLoaded':False}))

if __name__=='__main__':main()
