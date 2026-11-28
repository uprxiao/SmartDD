"""Pure endpoint-adjudication rules. No process/API calls; never certify a sample from invented fixtures.

The native collector must supply own, birth-bound graph attempts. This pure validator
is an additional guard, not an ownership proof by itself.
"""
from collections import Counter
from dataclasses import dataclass
import errno
from coalition_accounting import counter_valid

@dataclass(frozen=True)
class Verdict:
    state: str
    reason: str


def _pid_row(mapping, pid):
    return mapping.get(pid, mapping.get(str(pid)))


def _esrch(row, pid):
    return bool(row and row.get('pid') == pid and row.get('bytes') == 0 and row.get('errno') == errno.ESRCH)


def _bound_bsd(row, obs, uid, parent=None):
    return bool(obs and obs.get('pid') == row['pid'] and obs.get('returnedPid') == row['pid']
        and obs.get('bytes') == 136 and obs.get('errno') == 0 and obs.get('uid') == uid
        and f"{obs.get('birthSec')}:{obs.get('birthUsec')}" == row.get('birth')
        and (parent is None or obs.get('ppid') == parent))


def _uid_members(attempt, field):
    census = attempt.get(field, {})
    summary = census.get('summary', {})
    members = census.get('members', [])
    try:
        identities = {(m['pid'], m['birth']) for m in members if type(m.get('pid')) is int and m['pid'] > 0 and isinstance(m.get('birth'), str) and type(m.get('status')) is int and 0 < m['status'] < 5}
    except (KeyError, TypeError):
        return None
    if (summary.get('matchedIdentityGap') != 0 or summary.get('matchedNumeric') != len(members)
            or len(identities) != len(members) or len({pid for pid, _ in identities}) != len(members)):
        return None
    return identities


def _live(counter):
    return counter['tasks_started'] - counter['tasks_exited']


def _confirmed_leaf_pair(attempt, generic, disappearance):
    """Only the duplicate second-family ESRCH for a previously proven own leaf.

    The failed endpoint remains failed. This classifies whether it is eligible
    for a new current endpoint within the existing bounded sampling window.
    """
    pid = generic.get('pid')
    partner = disappearance
    if partner.get('pid') != pid or not _esrch(generic.get('minimalBefore'), pid):
        return False
    if not partner.get('parentVerified') or not partner.get('firstOwnedInventory'):
        return False
    if not _esrch(partner.get('minimalBefore'), pid) or not _esrch(partner.get('minimalAfter'), pid):
        return False
    rows = attempt.get('nodes', [])
    by_pid = {row['pid']: row for row in rows}
    if len(by_pid) != len(rows) or _pid_row(attempt.get('required', {}), pid) is not None:
        return False
    node = by_pid.get(pid)
    parent = by_pid.get(partner.get('parent'))
    if not node or not parent or parent['pid'] == pid:
        return False
    cid = attempt.get('cid')
    uid = parent.get('minimalAfter', {}).get('uid')
    if (not uid or node.get('birth') != partner.get('oldBirth') or node.get('parent') != parent['pid']
            or parent.get('birth') != partner.get('parentBirth')
            or node.get('role') != 'product' or not node.get('pathClass') or node.get('startAbstime', 0) <= 0
            or node.get('sameUid') is not True or node.get('alive') is not True or node.get('cid') != cid
            or parent.get('stableBeforeAfter') is not True or parent.get('sameUid') is not True or parent.get('cid') != cid
            or parent.get('role') != 'product' or parent.get('alive') is not True
            or pid not in parent.get('childrenBefore', [])):
        return False
    if not all(_bound_bsd(node, node.get(k), uid, parent['pid']) for k in ('minimalBefore', 'minimalAfter')):
        return False
    if not all(_bound_bsd(parent, parent.get(k), uid) for k in ('minimalBefore', 'minimalAfter', 'minimalFinal')):
        return False
    if not _esrch(node.get('minimalFinal'), pid):
        return False
    # The actual pre-inventory proved a leaf. There is no evidence of children
    # that might have become independently detached during its disappearance.
    family = _pid_row(attempt.get('families', {}), pid) or {}
    before_attempts = family.get('beforeAttempts', [])
    if (node.get('childrenBefore') != [] or node.get('childrenAfter') != [] or not before_attempts
            or before_attempts[-1].get('returnCount') != 0 or before_attempts[-1].get('errno') != 0
            or before_attempts[-1].get('pids') != []):
        return False
    before = _uid_members(attempt, 'uidBefore')
    after = _uid_members(attempt, 'uidAfter')
    counter_before, counter_after = attempt['counterBefore'], attempt['counterAfter']
    if before is None or after is None:
        return False
    return ((pid, node['birth']) in before and all(p != pid for p, _ in after)
        and (parent['pid'], parent['birth']) in before and (parent['pid'], parent['birth']) in after
        and counter_valid(counter_before, cid) and counter_valid(counter_after, cid)
        and len(before) == _live(counter_before) and len(after) == _live(counter_after)
        and counter_after['tasks_exited'] > counter_before['tasks_exited'])


def retry_gap_classification(attempt):
    # Keep the raw gaps exactly as collected. A generic family gap is only
    # paired with the independently proven same child disappearance above.
    gaps = attempt.get('gaps', [])
    canonical, proved_pairs = [], []
    for gap in gaps:
        if (gap['kind'] in ('candidate-all-esrch', 'candidate-identity-disappeared')
                and gap.get('parentVerified') and gap.get('firstOwnedInventory')):
            canonical.append(gap)
        elif gap['kind'] == 'owned-parent-not-current':
            matches = [g for g in gaps if g['kind'] == 'candidate-identity-disappeared' and g.get('pid') == gap.get('pid')]
            if len(matches) != 1 or not _confirmed_leaf_pair(attempt, gap, matches[0]):
                return None, []
            proved_pairs.append(gap['pid'])
        else:
            return None, []
    if len(proved_pairs) != len(set(proved_pairs)):
        return None, []
    return canonical, proved_pairs


def _complete_uid_endpoint(attempt):
    before = _uid_members(attempt, 'uidBefore')
    after = _uid_members(attempt, 'uidAfter')
    rows = {(n['pid'], n['birth']) for n in attempt['nodes']}
    return (before is not None and after is not None and before == after == rows
        and counter_valid(attempt['counterBefore'], attempt['cid']) and counter_valid(attempt['counterAfter'], attempt['cid'])
        and len(rows) == len(attempt['nodes']) == _live(attempt['counterBefore']) == _live(attempt['counterAfter']))


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
        eligible, paired_leaves = retry_gap_classification(attempt)
        if eligible is not None:
            if paired_leaves:
                return Verdict('retry','previously verified owned leaf disappeared during second family inventory; retain both raw gaps and resample')
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
    races, paired_leaves = retry_gap_classification(prior)
    if races is None:
        return Verdict('fatal','earlier unresolved non-ESRCH or unbound identity')
    if paired_leaves:
        if final.get('startNs', 0) < prior['endNs']:
            return Verdict('incomplete','leaf resample is not a new endpoint after the failed observation')
        if any(final['counterBefore'][key] < prior['counterAfter'][key] for key in ('tasks_started','tasks_exited','cpu_time')):
            return Verdict('fatal','leaf resample counters moved backwards')
        if final.get('cid') != prior.get('cid'):
            return Verdict('fatal','resource coalition changed before leaf resample')
        required = {int(pid): row for pid, row in final.get('required', {}).items()}
        scope = exact_coherent(final, required, prior['cid'], live_count_contract_verified=True)
        if scope.state != 'closed' or not _complete_uid_endpoint(final):
            return Verdict('incomplete','new leaf-resample endpoint lacks complete current UID/CID and graph closure')
    for race in races:
        parent=by_pid.get(race['parent'])
        if not parent or parent.get('birth')!=race.get('parentBirth'):
            return Verdict('fatal','original proven parent identity changed')
        if race['pid'] in by_pid or race['pid'] in parent['childrenBefore'] or race['pid'] in parent['childrenAfter']:
            # First ECSRH lacks a birth identity: do not guess whether PID now
            # belongs to an older or newer process. Keep diagnostic-only.
            return Verdict('incomplete','earlier candidate PID now present; original birth unavailable')
    return Verdict('endpoint-resampled','unbound earlier own-parent candidate absent from new closed live graph; no claim individually reaped; original raw attempt retained')
