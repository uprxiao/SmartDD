from pathlib import Path
import json,hashlib
R=Path('/private/tmp/willyou-m12-system-shortcuts-App036-002');r=json.loads((R/'raw.json').read_text());c=json.loads((R/'cleanup.json').read_text());rows={x['name']:x for x in r['checks']};tests=[]
def check(n,fn):
 try:fn();tests.append({'id':n,'passed':True})
 except Exception as e:tests.append({'id':n,'passed':False,'reason':str(e)})
def yes(x):assert x
names=['T024-history-T0-no-entry-no-shortcut','T024-terminal-physical-open-launcher','T009-physical-page-reload-not-host','T009-physical-find','T009-physical-new','T009-physical-close-web-not-window','T009-physical-reopen','T024-project-physical-negative','T009-T133-physical-terminal-host-reload','T133-physical-window-hide-preserves-PTY']
check('all-ten-original-business-observations',lambda:yes(r['status']=='executed-unjudged' and set(rows)==set(names)))
check('ten-distinct-actual-human-events',lambda:yes(len({(x['event']['at'],x['event']['phase'],x['event']['wcId']) for x in rows.values()})==10 and all(x['event'] in r['physicalEvents']['events'] for x in rows.values())))
check('no-tested-shortcut-synthesis-in-driver',lambda:yes(not any(x.get('key','') and x['key'].lower() in ['r','w','t','f','b'] for x in r['driverInputs'])))
check('five-page-shortcuts-from-native-page',lambda:yes(all(not rows[n]['event']['main'] for n in names[2:7]) and all(rows[n]['event']['meta'] for n in names[2:7])))
check('page-reload-http-and-page-origin-not-host',lambda:yes(rows[names[2]]['before']['origin']!=rows[names[2]]['after']['origin'] and rows[names[2]]['hostOrigin']==rows[names[8]]['beforeOrigin'] and sum(x['path']=='/a' for x in r['requests'])>=2))
check('new-close-and-reopen-real-tab-states',lambda:yes(len(rows[names[4]]['after']['tabs'])==len(rows[names[4]]['before']['tabs'])+1 and not any(t['url']==r['site']+'/a' for t in rows[names[5]]['after']['tabs']) and any(t['url']==r['site']+'/a' for t in rows[names[6]]['after']['tabs'])))
check('terminal-reload-main-origin-and-window-close-real-events',lambda:yes(rows[names[8]]['beforeOrigin']!=rows[names[8]]['afterOrigin'] and rows[names[8]]['samePTY'] and rows[names[8]]['event']['main'] and rows[names[9]]['event']['main']))
check('T024-three-physical-shiftB-contexts',lambda:yes(all(rows[n]['event']['main'] and rows[n]['event']['key']=='b' and rows[n]['event']['shift'] for n in [names[0],names[1],names[7]]) and r['legacyFixture']['projectId'] is None))
check('initial-once-and-single-original-guard',lambda:yes(r['initialForeground']['attempts']==1 and r['initialFocus']['actualStableMs']>=3000 and len(r['focusGuards'])==1 and not r['focusGuard'].get('yieldedAt')))
check('normal-exit-observer-server-and-cleanup',lambda:yes(r['appCleanup']['normalExitConfirmed'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[] and r['observerRemoved'] and r['fixtureServerClosed'] and c['allClear']))
o={'passed':all(x['passed'] for x in tests),'tests':tests,'caseDecisions':{'M12-T009':'A+S complete subject to Root raw/source review','M12-T133':'S complete subject to Root unchanged pre-M12 menu/window baseline review','M12-T024':'Partial: header A and physical T0/terminal/project complete; PPTX pending'},'rawSHA256':hashlib.sha256((R/'raw.json').read_bytes()).hexdigest(),'GeneralAccessed':False};(R/'judgement.json').write_text(json.dumps(o,ensure_ascii=False,indent=2)+'\n');print(json.dumps(o,ensure_ascii=False));raise SystemExit(0 if o['passed'] else 1)
