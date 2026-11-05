"""Only judges existing raw JSON. Broker exit is never App kernel status."""
import json
from pathlib import Path

def judge(raw):
    checks=[]
    def check(name,ok):checks.append({'name':name,'pass':bool(ok)})
    events=raw.get('events',[]);actual=raw.get('actual',{});life=raw.get('appLifecycle',[])
    launch=[x for x in events if x.get('kind')=='launched']
    check('compiler-passed-before-launch',raw.get('compile',{}).get('exitCode')==0)
    check('exact-one-public-launch-callback',len(launch)==1)
    check('actual-owned-pid',bool(raw.get('appPid')) and actual.get('pid')==raw.get('appPid') and len(launch)==1 and launch[0]['pid']==raw['appPid'])
    expected=raw.get('expectedIdentity',{})
    canonical=expected.get('canonical',{});actual_paths=raw.get('actualCanonical',{});callback=raw.get('callbackCanonical',{})
    check('actual-private-root',bool(canonical) and raw.get('privateIdentityVerified') is True and actual.get('uid')==expected.get('uid') and all(actual_paths.get(k)==canonical.get(v) for k,v in [('appPath','appPathAsar'),('exe','exe'),('userData','userData'),('home','home'),('codexHome','codexHome'),('privateData','userData')]) and actual.get('sensitiveEnvNames')==[] and len(launch)==1 and callback.get('bundle')==canonical.get('appPath') and callback.get('exe')==canonical.get('exe') and launch[0].get('bundleCanonicalPath')==canonical.get('appPath') and launch[0].get('executableCanonicalPath')==canonical.get('exe'))
    check('DOM-and-native-focus-facts-recorded',type(raw.get('focusObservation',{}).get('dom',{}).get('hasFocus')) is bool and isinstance(raw.get('focusObservation',{}).get('nativeWindows'),list) and type(raw.get('focusObservation',{}).get('callbackActive')) is bool)
    check('no-activation-or-pid-replacement',not any(x.get('kind') in ['owned-activation','pid-changed'] for x in events) and not any(x.get('focused') for x in actual.get('windows',[])))
    check('both-debug-listeners-owned',len(raw.get('portOwnership',[]))==2 and all(x.get('pids') and set(x['pids'])=={raw.get('appPid')} for x in raw['portOwnership']))
    cid=raw.get('kernelCids',{})
    check('kernel-own-identities-and-cid-read',bool(cid.get('rows')) and all(x.get('verifiedLiveOwnIdentity') and x.get('stableIdentityAcrossCidRead') and x.get('coalition',{}).get('bytes')==40 and x.get('coalition',{}).get('errno')==0 and x['coalition'].get('resourceId',0)>0 for x in cid.get('rows',[])))
    check('kernel-counter-read-permission',bool(cid.get('counters')) and all(x.get('rc')==0 and x.get('errno')==0 and x.get('prefixBytes')==32 for x in cid.get('counters',[])))
    app_pids={x['pid'] for x in actual.get('metrics',[])};host_pids={raw.get('runnerPid'),raw.get('brokerPid')}
    app_ids={x['coalition']['resourceId'] for x in cid.get('rows',[]) if x.get('pid') in app_pids and x.get('coalition')}
    host_ids={x['coalition']['resourceId'] for x in cid.get('rows',[]) if x.get('pid') in host_pids and x.get('coalition')}
    check('app-cids-distinct-from-host',bool(app_ids) and bool(host_ids) and app_pids.issubset({x['pid'] for x in cid.get('rows',[])}) and host_pids.issubset({x['pid'] for x in cid.get('rows',[])}) and set(raw.get('appResourceIds',[]))==app_ids and set(raw.get('hostResourceIds',[]))==host_ids and not app_ids&host_ids)
    check('actual-app-quit-event',raw.get('normalQuitRequested') and all(any(e.get('kind')==kind and e.get('pid')==raw.get('appPid') for e in life) for kind in ['before-quit','will-quit']) and any(e.get('kind')=='quit' and e.get('pid')==raw.get('appPid') and e.get('code')==0 for e in life))
    check('actual-App-terminated-and-cleanup',any(x.get('kind')=='app-terminated' for x in events) and raw.get('allKnownGone') is True and raw.get('remainingExactCloneExecutables')==[] and len(raw.get('portCleanup',[]))==2 and all(x.get('closed') for x in raw['portCleanup']) and not raw.get('cleanupUnresolved'))
    check('kernel-status-not-invented',raw.get('kernelAppExitCode') is None and raw.get('kernelAppSignal') is None and raw.get('brokerExitIsNotAppExit') is True)
    check('no-hidden-driver-errors',not raw.get('errors'))
    return {'checks':checks,'narrowCidCapabilityObserved':all(x['pass'] for x in checks),'T111Passed':False,'formalCaseCredit':0,'appKernelExitCode':None,'appKernelSignal':None,'boundary':'App quit event and NSRunningApplication termination are distinct from unavailable kernel wait status. A distinct CID does not imply App-exclusive membership or CPU<5.'}

if __name__=='__main__':
    r=Path(__file__).parent;result=judge(json.loads((r/'raw.json').read_text()));(r/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
