from pathlib import Path
import json,hashlib
R=Path('/private/tmp/willyou-m12-t024-pptx-App036-002');r=json.loads((R/'raw.json').read_text());c=json.loads((R/'cleanup.json').read_text());z=json.loads((R/'saved-zip-inspection.json').read_text());tests=[]
def check(n,f):
 try:f();tests.append({'id':n,'passed':True})
 except Exception as e:tests.append({'id':n,'passed':False,'reason':str(e)})
def yes(x):assert x
check('real-physical-shiftCommandB-in-main-PPTX-editor',lambda:yes(r['status']=='executed-unjudged' and r['physicalKey']['key']=='b' and r['physicalKey']['meta'] and r['physicalKey']['shift'] and r['physicalKey']['wcId']==r['window']['mainWC']))
check('selected-LayerTarget-moved-to-bottom',lambda:yes(r['checks'][0]['beforeOrder']==['201','202','203','204'] and r['checks'][0]['afterOrder']==['202','201','203','204']))
check('no-new-browser-tab-or-active-browser-change',lambda:yes(r['browserBefore']['tabs']==r['browserAfter']['tabs']==[] and r['browserBefore']['activeId']==r['browserAfter']['activeId'] is None))
check('real-native-save-and-independent-ZIP-order',lambda:yes(r['checks'][0]['savedOrder']==[o['id'] for o in z['objects']]==['202','201','203','204'] and hashlib.sha256((R/'runtime-001/project/layer.pptx').read_bytes()).hexdigest()==r['fixtureSavedSHA256']))
check('four-native-delegates-restored-with-unchanged-arguments',lambda:yes(len(r['fileObserverRestored'])==4 and all(r['fileObserverRestored'].values()) and all(x['input']==x['inputAfter'] and x['before']==x['after'] for x in r['fileTrace'] if x.get('delivered'))))
check('actual-system-PID-native-DOM-stable-initial-focus',lambda:yes(r['initialFocus']['actualStableMs']>=3000 and all(x['front']['pid']==r['appPid'] for x in r['initialFocus']['stableSamples']) and r['initialForeground']['attempts']==1))
check('single-guard-normal-exit-and-clear',lambda:yes(len(r['focusGuards'])==1 and not r['focusGuard'].get('yieldedAt') and r['appCleanup']['normalExitConfirmed'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[] and r['keyObserverRemoved'] and c['allClear']))
check('original-PPTX-business-image',lambda:yes(any(x['name']=='physical-pptx-layer-to-back.png' and hashlib.sha256((R/'runtime-001'/x['name']).read_bytes()).hexdigest()==x['sha256'] for x in r['screenshots'])))
o={'passed':all(x['passed'] for x in tests),'tests':tests,'case':'M12-T024 Pages conflict only; full case requires linked header/system/T0/project evidence','rawSHA256':hashlib.sha256((R/'raw.json').read_bytes()).hexdigest(),'wholeCaseCombinedReviewPending':True,'GeneralAccessed':False};(R/'judgement.json').write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n');print(json.dumps(o,ensure_ascii=False));raise SystemExit(0 if o['passed'] else 1)
