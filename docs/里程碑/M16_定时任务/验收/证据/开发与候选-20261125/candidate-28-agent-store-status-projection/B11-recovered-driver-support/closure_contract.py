"""Pure endpoint-adjudication rules. No process/API calls; never certify a sample from invented fixtures.

The native collector must supply own, birth-bound graph attempts. This pure validator
is an additional guard, not an ownership proof by itself.
"""
from collections import Counter
from dataclasses import dataclass

@dataclass(frozen=True)
class Verdict:
    state: str
    reason: str


def exact_coherent(attempt,required,cid,*,live_count_contract_verified):
    if not live_count_contract_verified:
        return Verdict('incomplete','current native live-count semantics not established')
    if attempt.get('cid')!=cid or attempt.get('outsideCid')==cid:
        return Verdict('fatal','coalition identity or exclusive launch scope changed')
    before=attempt['counterBefore'];after=attempt['counterAfter']
    if any(before[k]>after[k] for k in ('tasks_started','tasks_exited','cpu_time')):
        return Verdict('fatal','native counters decreased')
    live=after['tasks_started']-after['tasks_exited']
    if live<1:return Verdict('fatal','invalid native live count')
    nodes=attempt['nodes'];by_pid={x['pid']:x for x in nodes}
    if len(by_pid)!=len(nodes):return Verdict('fatal','duplicate or reused PID in final graph')
    if len({(x['pid'],x['birth']) for x in nodes})!=len(nodes):return Verdict('fatal','duplicate native identity')
    for pid,bound in required.items():
        row=by_pid.get(pid)
        if not row or row.get('birth')!=bound['birth'] or row.get('pathClass')!=bound['pathClass']:
            return Verdict('fatal','retained anchor identity absent/changed')
    if attempt.get('gaps'):
        # Scope/counter/identity defects are fatal, not retries. A candidate missing
        # before its read is never silently assigned an identity or zero RSS.
        if all(x['kind'] in ('candidate-all-esrch','candidate-identity-disappeared') and x.get('parentVerified') and x.get('firstOwnedInventory') for x in attempt['gaps']):
            return Verdict('retry','owned-parent candidate raced; retain raw attempt and resample')
        return Verdict('fatal','unreadable or unbound candidate; do not reclassify')
    if before['tasks_started']!=after['tasks_started'] or before['tasks_exited']!=after['tasks_exited']:
        return Verdict('retry','family/coalition live set changed during this bounded attempt')
    anchors=set(required);children=set();instrument=0
    for row in nodes:
        if not row.get('stableBeforeAfter') or row.get('cid')!=cid or not row.get('sameUid') or not row.get('alive') or not isinstance(row.get('rss'),int) or row['rss']<0:
            return Verdict('retry','native identity/RSS before-after not stable')
        if row.get('role') not in ('product','instrument'):return Verdict('incomplete','no exact scope classification')
        if row['role']=='instrument':instrument+=1
        if set(row['childrenBefore'])!=set(row['childrenAfter']):return Verdict('retry','actual own-child membership changed')
        for child in row['childrenAfter']:
            x=by_pid.get(child)
            if not x or x.get('parent')!=row['pid']:return Verdict('retry','incomplete child link')
            children.add(child)
        if row['pid'] not in anchors and row.get('parent') not in by_pid:return Verdict('incomplete','unbound root/orphan')
    if set(by_pid)-anchors-children:return Verdict('incomplete','unreachable process identity')
    # Reachability/cycle detection. Anchored detached members are permitted only if
    # they are independently verified before the snapshot by the current run ledger.
    reached=set();visiting=set()
    def visit(pid):
        if pid in visiting:raise ValueError('cycle')
        if pid in reached:return
        visiting.add(pid)
        for child in by_pid[pid]['childrenAfter']:visit(child)
        visiting.remove(pid);reached.add(pid)
    try:
        for root in anchors:visit(root)
    except ValueError:return Verdict('fatal','own graph cycle')
    if reached!=set(by_pid):return Verdict('incomplete','graph not reachable from exact roots')
    if len(nodes)!=live:return Verdict('incomplete','cohort actual net-live count differs from proven member graph; RSS cannot be complete')
    return Verdict('closed','all live nodes exact and scope count closes')


def retry_resolution(prior,final,*,same_period,max_ns=2_000_000_000):
    """First failed observations remain evidence. A later endpoint may be closed,
    but never claims missing PID was a reaped known identity or clears CPU scope.
    """
    if not same_period or final['endNs']-prior['startNs']>max_ns:
        return Verdict('incomplete','later endpoint not within same bounded cadence')
    by_pid={x['pid']:x for x in final['nodes']}
    for race in prior.get('gaps',[]):
        if race['kind'] not in ('candidate-all-esrch','candidate-identity-disappeared') or not race.get('firstOwnedInventory') or not race.get('parentVerified'):
            return Verdict('fatal','earlier unresolved non-ESRCH or unbound identity')
        parent=by_pid.get(race['parent'])
        if not parent or parent.get('birth')!=race.get('parentBirth'):
            return Verdict('fatal','original proven parent identity changed')
        if race['pid'] in by_pid or race['pid'] in parent['childrenBefore'] or race['pid'] in parent['childrenAfter']:
            # First ECSRH lacks a birth identity: do not guess whether PID now
            # belongs to an older or newer process. Keep diagnostic-only.
            return Verdict('incomplete','earlier candidate PID now present; original birth unavailable')
    return Verdict('endpoint-resampled','unbound earlier own-parent candidate absent from new closed live graph; no claim individually reaped; original raw attempt retained')
