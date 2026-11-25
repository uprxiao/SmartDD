"""Verify archived local fixture traces and counts, not actual-app acceptance."""
from pathlib import Path
import json
import re

here = Path(__file__).resolve().parent
data = lambda name: [json.loads(line) for line in (here / name).read_text().splitlines()]
def phase(rows, case, label):
    items = [x for x in rows if x['case']==case and x['phase']==label]
    assert len(items)==1, (case,label,len(items))
    return items[0]

def selects(row): return sum(x['event']=='rpc.select' for x in row['calls'])
def log_contains(name, expected):
    text = re.sub(r'\x1b\[[0-9;]*[mK]','',(here / name).read_text())
    assert expected in text, (name,expected)

results=[]
for run in (2,3):
    rows=data(f'renderer-trace-run{run}.jsonl')
    a='red-A-empty-before-presentation'
    remembered=phase(rows,a,'new-user-input-remembered')
    closed=phase(rows,a,'old-empty-cleanup-released')
    shown=phase(rows,a,'after-new-presentation')
    assert remembered['guard'] is True and closed['revision']==remembered['revision']+1
    assert closed['guard'] is False and shown['guard'] is False
    assert len(shown['host']['tabs'])==1 and shown['host']['tabs'][0]['loading']
    assert shown['panel']['active']=='files' and shown['address'] is None and selects(shown)==0
    b='red-B-empty-during-select'
    start=phase(rows,b,'empty-store-commit-before-passive-cleanup')
    selecting=phase(rows,b,'select-started-before-old-render-cleanup')
    closed=phase(rows,b,'react-empty-effect-settled-while-selecting')
    done=phase(rows,b,'after-select-and-new-snapshot-replies')
    page=selecting['host']['activeId']
    assert start['guard'] is True and selects(selecting)==1 and page
    assert closed['revision']==start['revision']+1 and closed['guard'] is False
    assert done['host']['activeId']==done['snapshot']['activeId']==page
    assert done['guard'] is False and done['panel']['active']=='files' and done['address'] is None and selects(done)==1
    p=phase(rows,'settled-close','loading-visible')
    q=phase(rows,'settled-close','same-page-ready-visible')
    assert p['panel']['active']==q['panel']['active']=='browser'
    assert p['host']['activeId']==q['host']['activeId']
    assert p['address']==q['address']=='https://fixture.invalid/f36-new'
    old_replies=phase(rows,'new-snapshot-supersedes-old','older-empty-replies-dropped')
    assert old_replies['guard'] is True and len(old_replies['snapshot']['tabs'])==1
    assert phase(rows,'new-snapshot-supersedes-old','new-snapshot-visible')['panel']['active']=='browser'
    explicit=phase(rows,'deliberate-close-revokes-earlier-intent','old-intent-does-not-undo-deliberate-close')
    assert explicit['guard'] is False and selects(explicit)==0 and 'browser' not in explicit['panel']['tabs']
    for case,label,total in [('deliberate-user-file-switch','user-panel-switch-preserved',0),
                              ('deliberate-user-switch-while-selecting','user-panel-switch-during-select-preserved',1)]:
        intent=phase(rows,case,label)
        assert intent['guard'] is False and intent['panel']['active']=='files' and selects(intent)==total
    background=phase(rows,'background-and-deliberate-reveal','background-no-show-intent')
    reveal=phase(rows,'background-and-deliberate-reveal','explicit-reveal-existing-page')
    rejected=phase(rows,'background-and-deliberate-reveal','closed-explicit-reveal-rejected')
    assert selects(background)==0 and 'browser' not in background['panel']['tabs']
    assert selects(reveal)==1 and reveal['panel']['active']=='browser'
    assert 'browser' not in rejected['panel']['tabs']
    log_contains(f'renderer-run{run}.log','Tests  2 failed | 6 passed (8)')
    results.append({'run':run,'redA':{'revisionAdvance':1,'selectCount':0,'address':None},
                        'redB':{'revisionAdvance':1,'selectCount':1,'hostAndStoreSelected':True,'address':None},
                        'sixControlsPassed':True})
rows=data('renderer-prior-close-trace.jsonl')
c='prior-intent-close-before-cleanup'
intent=phase(rows,c,'new-user-input-remembered')
explicit=phase(rows,c,'deliberate-close-accepted-empty-replies-held')
reopened=phase(rows,c,'older-show-arrives-after-explicit-close')
assert explicit['revision']==intent['revision'] and explicit['guard'] is True
assert selects(reopened)==1 and reopened['host']['activeId'] and reopened['address']=='https://fixture.invalid/f36-new'
log_contains('renderer-prior-close.log','Tests  1 failed | 8 skipped (9)')
rows=data('host-trace-run2.jsonl')
assert len(phase(rows,'parser','invalid-target-rejected-and-valid-accepted')['value'])==4
closed=phase(rows,'close-new-receipt','closed-old-id-rejected')['value']
assert closed['old'] in closed['closed'] and closed['tabs']==[]
ready=phase(rows,'close-new-receipt','new-logical-page-and-ready-receipt')['value']
assert ready['receipt']['pageId']!=ready['old'] and ready['ready']['summary']['phase']=='ready'
assert ready['receipt']['pageId']==ready['ready']['summary']['pageId']
assert ready['showCalls']==[ready['receipt']['pageId']]
replayed=phase(rows,'close-new-receipt','same-request-after-close-returns-receipt-without-reopening')['value']
assert replayed['tabs']==[] and replayed['replay']['pageId']==ready['receipt']['pageId']
cancelled=phase(rows,'late-closed-pending','cancelled-old-and-distinct-next')['value']
assert cancelled['cancelled']['summary']['phase']=='cancelled' and cancelled['replay']['pageId']==cancelled['first']['pageId']
assert cancelled['second']['pageId']!=cancelled['first']['pageId'] and cancelled['ready']['state']=='succeeded'
exact=phase(rows,'logical-exact-match','match-identities')['value']
assert exact['distinctCount']==6 and exact['first']['pageId']==exact['reuse']['pageId'] and exact['reuse']['reused']
log_contains('host-run2.log','Tests  4 passed (4)')
log_contains('existing-workspace.log','Tests  14 passed (14)')
log_contains('existing-service-open.log','Tests  3 passed | 31 skipped (34)')
log_contains('existing-browser-renderer-focused.log','Tests  23 passed (23)')
log_contains('existing-panels-focused.log','Tests  4 passed | 1 skipped (5)')
schema=json.loads((here/'schema-diagnostic.json').read_text())
assert schema['sourceRequired']==[] and schema['definitionRetainsInput']
assert all(schema['actualAjvResults'].values())
for invalid in schema['expectedHostInvalidCases']: assert not schema['privateAjvCompositionFeasibility'][invalid]
assert schema['privateAjvCompositionFeasibility']['urlOnly'] and schema['privateAjvCompositionFeasibility']['pageOnly']
print(json.dumps({'source':'a0acddb3a','scope':'BE04/BE05 software-layer only; synthetic IPC / native navigation boundaries; not actual App acceptance',
 'rendererRepeatedResults':results,'supplementalRedC':{'explicitCloseDidNotAdvanceRevision':True,'oldIntentSelectCount':1},
 'newHostTestsPassed':4,'existingWorkspaceTestsPassed':14,'existingSelectedServiceTestsPassed':3,
 'existingBrowserRendererTestsPassed':23,'existingSelectedPanelsTestsPassed':4,
 'schemaGap':{'baselineAjvAcceptedInvalidCases':4,'actualHostRejectedInvalidCases':4,'privateAjvCompositionRejectedInvalidCases':4},
 'remaining': 'Actual frozen provider/MCP/CLI projection, native view closure/navigation, genuine model/UI trace and candidate actual-app regressions; unrelated long diff test fixture limitation remains.',
 },ensure_ascii=False,indent=2))
