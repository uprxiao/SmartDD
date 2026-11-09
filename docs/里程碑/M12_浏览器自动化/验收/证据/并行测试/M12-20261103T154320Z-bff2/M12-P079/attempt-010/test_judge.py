"""Small pure-data controls for ownership/quit-status adjudication, not Native tests."""
from copy import deepcopy
from judge import judge
from pathlib import Path
import json

e={'appPath':'/private/tmp/fixture/App.app','exe':'/private/tmp/fixture/App.app/Contents/MacOS/App','appPathAsar':'/private/tmp/fixture/App.app/Contents/Resources/app.asar','userData':'/private/tmp/fixture/data','home':'/private/tmp/fixture/home','codexHome':'/private/tmp/fixture/codex','uid':501}
e['canonical']=dict(e)
a={k:e[v] for k,v in [('uid','uid'),('appPath','appPathAsar'),('exe','exe'),('userData','userData'),('home','home'),('codexHome','codexHome'),('privateData','userData')]};a.update(pid=100,windows=[{'focused':False}],metrics=[{'pid':100}],sensitiveEnvNames=[])
rows=[{'pid':pid,'verifiedLiveOwnIdentity':True,'stableIdentityAcrossCidRead':True,'coalition':{'resourceId':cid,'bytes':40,'errno':0}} for pid,cid in [(100,900),(101,719),(102,719)]]
r={'compile':{'exitCode':0},'appPid':100,'runnerPid':101,'brokerPid':102,'expectedIdentity':e,'actual':a,'actualCanonical':{k:a[k] for k in ['appPath','exe','userData','home','codexHome','privateData']},'callbackCanonical':{'bundle':e['appPath'],'exe':e['exe']},'privateIdentityVerified':True,'events':[{'kind':'launched','pid':100,'bundlePath':e['appPath'],'executablePath':e['exe'],'bundleCanonicalPath':e['appPath'],'executableCanonicalPath':e['exe']},{'kind':'app-terminated','pid':100}],'portOwnership':[{'pids':[100]},{'pids':[100]}],'kernelCids':{'rows':rows,'counters':[{'rc':0,'errno':0,'prefixBytes':32}]},'appResourceIds':[900],'hostResourceIds':[719],'normalQuitRequested':True,'appLifecycle':[{'kind':k,'pid':100,'code':0} for k in ['before-quit','will-quit','quit']],'focusObservation':{'dom':{'hasFocus':False},'nativeWindows':a['windows'],'callbackActive':False},'allKnownGone':True,'remainingExactCloneExecutables':[],'portCleanup':[{'closed':True},{'closed':True}],'brokerExit':{'code':0},'brokerExitIsNotAppExit':True,'kernelAppExitCode':None,'kernelAppSignal':None,'errors':[]}
checks=[]
def check(name,ok):
    assert ok,name
    checks.append({'name':name,'pass':True})
check('synthetic-healthy-parser-only',judge(r)['narrowCidCapabilityObserved'])
for name,mutate in [
 ('missing-launch',lambda x:x['events'].pop(0)),
 ('wrong-userData',lambda x:x['actualCanonical'].__setitem__('userData','/daily-profile')),
 ('foreign-listener',lambda x:x['portOwnership'][0].__setitem__('pids',[999])),
 ('shared-cid',lambda x:x['kernelCids']['rows'][0]['coalition'].__setitem__('resourceId',719)),
 ('counter-EPERM',lambda x:x['kernelCids']['counters'][0].__setitem__('errno',1)),
 ('broker0-without-Appquit',lambda x:x.__setitem__('appLifecycle',[])),
 ('invented-kernel0',lambda x:x.__setitem__('kernelAppExitCode',0)),
 ('pending-callback-cleanup',lambda x:x.__setitem__('cleanupUnresolved',True)),
 ('remaining-private-App',lambda x:x.__setitem__('remainingExactCloneExecutables',[{'pid':100}])),
 ('activation',lambda x:x['events'].append({'kind':'owned-activation','pid':100})),
]:
    case=deepcopy(r);mutate(case);check('reject-'+name,not judge(case)['narrowCidCapabilityObserved'])
check('no-formal-credit-even-parser-healthy',not judge(r)['T111Passed'] and judge(r)['formalCaseCredit']==0)
(Path(__file__).parent/'pure-data-checks.json').write_text(json.dumps({'syntheticOnly':True,'NativeExecuted':False,'checks':checks},indent=2)+'\n')
print(json.dumps({'pureDataChecks':len(checks),'NativeExecuted':False}))
