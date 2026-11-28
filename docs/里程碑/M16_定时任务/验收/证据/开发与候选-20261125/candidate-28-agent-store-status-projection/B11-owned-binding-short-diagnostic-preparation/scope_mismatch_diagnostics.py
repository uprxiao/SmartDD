"""Redacted actual return summaries; no process queries or adjudication.

Only called after the original collector has bound the first own BSD/CID.
Do not reconstruct missing old observations or persist unrelated executable
paths. All existing fatal/retry decisions remain the caller's responsibility.
"""
import hashlib
from coalition_accounting import cid_valid


def _birth(row):
    return f"{row.get('birthSec')}:{row.get('birthUsec')}"


def _bsd(initial, current, pid, uid, *, actual_bsd_size):
    if current is None:
        return {"observed": False}
    valid = (current.get("pid") == pid and current.get("returnedPid") == pid
             and current.get("bytes") == actual_bsd_size and current.get("errno") == 0
             and current.get("uid") == uid and current.get("birthSec", 0) > 0)
    same_birth = valid and _birth(initial) == _birth(current)
    out = {
        "observed": True, "pid": pid, "bytes": current.get("bytes"),
        "errno": current.get("errno"), "requestedPidMatches": current.get("pid") == pid,
        "returnedPidMatches": current.get("returnedPid") == pid,
        "ownUidMatches": current.get("uid") == uid, "validOwnBsd": valid,
        "sameBirth": same_birth,
        "sameParentAsFirst": same_birth and current.get("ppid") == initial.get("ppid"),
    }
    if same_birth:
        # Only the already proven own birth. Unexpected/reused foreign numeric
        # results are retained as equality flags, never their UID, birth or path.
        out.update(birth=_birth(current), status=current.get("status"))
        if out["sameParentAsFirst"]:
            out["parent"] = current.get("ppid")
    return out


def _cid(raw, pid, own_cid):
    if raw is None:
        return {"observed": False}
    valid = cid_valid(raw, pid)
    matches = valid and raw.get("resourceId") == own_cid
    out = {
        "observed": True, "pid": pid, "pidMatches": raw.get("pid") == pid,
        "bytes": raw.get("bytes"), "errno": raw.get("errno"),
        "valid": valid, "matchesOwnedResource": matches,
        "reservedZero": raw.get("reserved") == [0, 0, 0],
        "startNs": raw.get("startNs"), "endNs": raw.get("endNs"),
    }
    if matches:
        out["ownedResourceId"] = own_cid
    return out


def _path(raw):
    if raw is None:
        return {"observed": False}
    rc, err, path = raw
    # Only executable paths which the original collector read after owned
    # binding are passed here. Persist the digest, never pathname plaintext.
    return {"observed": True, "rc": rc, "errno": err,
            "returned": bool(path), "sha256": hashlib.sha256(path.encode()).hexdigest() if path else None}


def bound_failure_details(pid, parent, anchor, first, first_cid, usage, first_path,
                          *, own_uid, own_cid, actual_bsd_size,
                          second=None, second_cid=None, second_path=None,
                          rss_exception=None, stage):
    first_obs = _bsd(first, first, pid, own_uid, actual_bsd_size=actual_bsd_size)
    first_cid_obs = _cid(first_cid, pid, own_cid)
    assert first_obs["validOwnBsd"] and first_obs["sameBirth"] and first_cid_obs["matchesOwnedResource"]
    second_obs = _bsd(first, second, pid, own_uid, actual_bsd_size=actual_bsd_size)
    second_cid_obs = _cid(second_cid, pid, own_cid)
    path1, path2 = _path(first_path), _path(second_path)
    same_path = (path1.get("sha256") == path2.get("sha256")
                 if path1.get("returned") and path2.get("returned") else None)
    return {
        "schema": "own-scope-bound-failure-observations-v1", "stage": stage,
        "first": {"bsd": first_obs, "cid": first_cid_obs, "path": path1,
                  "usage": {k: usage.get(k) for k in ("rc", "errno", "startAbstime", "exitAbstime")}},
        "second": {"bsd": second_obs, "cid": second_cid_obs, "path": path2},
        "pathHashEqual": same_path, "rssException": rss_exception,
        "expectedParentPid": parent, "firstParentMatchesExpected": parent is None or first.get("ppid") == parent,
        "exactAnchorRequested": anchor, "observationsOnly": True,
    }
