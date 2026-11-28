"""Offline only. Actual retained endpoint replay and pure controlled return tests.
No App, process queries, listener, model, OS operation or new native observations.
"""
import ast
import copy
import errno
import gzip
import hashlib
import json
import pathlib
import re
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

from closure_contract import exact_coherent, retry_gap_classification, retry_resolution
import own_scope_native as original
import own_scope_native_diagnostic as amended

base = pathlib.Path(__file__).resolve().parent
repo = base.parents[2]
history = repo / "docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125"
r4path = base / "run-0iKsJY/scope-attempts.jsonl"
r5path = base / "run-QsHCN9/scope-attempts.jsonl"
c22path = history / "candidate-22-notification-ownership-and-cold-paint/B11-full-1800s-scoped-rss-trend-red-agent-staging/archive-safe/scope-attempts.jsonl.gz"
c22old = history / "candidate-22-notification-ownership-and-cold-paint/B11-XPC-identity-green-Git-churn/index.json"
c27path = history / "candidate-27-schedule-active-query-reuse/B11-real-1800s-recheck/archive-safe/scope-attempts.jsonl.gz"

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def records(p):
    with (gzip.open(p, "rt") if p.suffix == ".gz" else p.open()) as f:
        return [json.loads(line) for line in f]

def exact(a):
    return exact_coherent(a, {int(pid): r for pid, r in a["required"].items()}, a["cid"], live_count_contract_verified=True)

def actual_closed(rows):
    count = 0
    for r in rows:
        if not r["closedCandidate"]:
            continue
        a = r["attempts"][-1]
        assert exact(a).state == "closed"
        ids = lambda values: {(x["pid"], x["birth"]) for x in values}
        assert ids(a["uidBefore"]["members"]) == ids(a["uidAfter"]["members"]) == ids(a["nodes"])
        assert sum(n["rss"] for n in a["nodes"] if n["role"] == "product") == r["actualProductRssBytes"]
        count += 1
    return count

r4, r5, c22, c27 = [records(p) for p in (r4path, r5path, c22path, c27path)]
failed4, failed5 = r4[-1]["attempts"][-1], r5[-1]["attempts"][-1]
assert failed4["candidateVerdict"]["state"] == "fatal"
assert exact(failed4).state == "retry" and retry_gap_classification(failed4)[1] == [84385]
assert failed5["candidateVerdict"]["state"] == "fatal" and exact(failed5).state == "fatal"
assert failed5["gaps"] == [{"kind": "identity-raced-after-owned-binding", "pid": 93936}]
assert retry_gap_classification(failed5)[0] is None
assert r5[-1]["minute"] == 10 and not r5[-1]["closedCandidate"]
pid, parent = 93936, 86795
member = lambda a, k: [x for x in a[k]["members"] if x["pid"] == pid]
before, after = member(failed5, "uidBefore"), member(failed5, "uidAfter")
assert before == after == [{"pid": pid, "birth": "1795768399:309501", "status": 2}]
prow = next(x for x in failed5["nodes"] if x["pid"] == parent)
assert pid in prow["childrenBefore"] and pid in prow["childrenAfter"]
assert failed5["uidBefore"]["summary"]["matchedIdentityGap"] == failed5["uidAfter"]["summary"]["matchedIdentityGap"] == 0
assert len(failed5["uidBefore"]["members"]) == len(failed5["uidAfter"]["members"]) == 35
assert len(failed5["nodes"]) == 34
assert pid not in {x["pid"] for x in failed5["nodes"]}
assert failed5["counterBefore"]["tasks_started"] == 3054 and failed5["counterBefore"]["tasks_exited"] == 3019
assert failed5["counterAfter"]["tasks_started"] == 3055 and failed5["counterAfter"]["tasks_exited"] == 3020
old = json.loads(c22old.read_text())
assert old["candidateVerdict"]["state"] == "fatal"
assert old["gaps"][0] == {"kind":"identity-raced-after-owned-binding","pid":62304}
actual_counts = {k: actual_closed(v) for k,v in (("C27", c27), ("C22", c22), ("R4", r4), ("R5", r5))}
assert actual_counts == {"C27":18, "C22":18, "R4":5, "R5":9}
actual_esrch = []
for row in c22:
    for a in row["attempts"][:-1]:
        if any(g["kind"] == "candidate-all-esrch" for g in a["gaps"]):
            assert exact(a).state == "retry"
            assert retry_resolution(a, row["attempts"][-1], same_period=True).state == "endpoint-resampled"
            actual_esrch.append(row["label"])
assert actual_esrch == ["milestone-pre-command"]

# All formal R5 source pins remain unchanged. Diagnostic file changes add only
# observation and a different, explicitly nonformal, coordinator workflow.
formal = json.loads((base/"static-preflight-scope-r5.json").read_text())
assert formal["actualRunNotStarted"] is True
for name, digest in formal["sourcePins"].items():
    assert sha(base/name) == digest, name
source = (base/"own_scope_native.py").read_text()
source2 = (base/"own_scope_native_diagnostic.py").read_text()
fn = lambda text,name: next(n for n in ast.walk(ast.parse(text)) if isinstance(n,ast.FunctionDef) and n.name == name)
native_calls = lambda tree: [ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n,ast.Call) and ast.unparse(n.func).startswith("self.n.")]
assert sorted(native_calls(fn(source,"exact_row"))) == sorted(native_calls(fn(source2,"exact_row")))
for name in ("capture","uid_census","xpc_roots","owned_children","idle_counter","runtime_roots","init"):
    assert ast.dump(fn(source,name),include_attributes=False) == ast.dump(fn(source2,name),include_attributes=False)
orig_js = (base/"run.mjs").read_text()
diag_js = (base/"run-scope-diagnostic.mjs").read_text()
for start,end in (("async function resourceRead", "async function parkedNative"), ("async function parkedNative", "async function longResource")):
    assert orig_js[orig_js.index(start):orig_js.index(end)] == diag_js[diag_js.index(start):diag_js.index(end)]
assert "continue-1800s" not in diag_js and "formalEligible:false" in diag_js and "formalCasePassCandidate:false" in diag_js
assert "scopeObservation('diagnostic-pre-command'" in diag_js and "scopeObservation('diagnostic-post-command'" in diag_js
assert "i<30" in diag_js and ">=12)break" in diag_js
launch = (base/"launch-scope-diagnostic.mjs").read_text()
wrapper = (base/"wrapper-scope-diagnostic.m").read_text()
assert "'--diagnostic-approved'" in launch and "driver=join(BASE,'run-scope-diagnostic.mjs')" in launch and "continue-1800s" not in launch
assert 'run-scope-diagnostic.mjs"]' in wrapper and 'diagnosticOnly' in wrapper

# Controlled synthetic native returns through the ACTUAL old/new collector
# functions. Bind the fake minimal BSD shape to the archived R4 proven leaf;
# synthetic path/CID/API-error controls are not observations of R4 or R5.
leaf = next(n for n in failed4["nodes"] if n["pid"] == 84385)
ownpid, ownparent, uid = leaf["pid"], leaf["parent"], leaf["minimalBefore"]["uid"]
cidnum = failed4["cid"]
first = copy.deepcopy(leaf["minimalBefore"])
good_second = copy.deepcopy(leaf["minimalAfter"])
assert first["pid"] == ownpid and first["ppid"] == ownparent

def fake_cid(resource=cidnum, bad=None):
    return {"pid":ownpid,"bytes":40,"errno":0,"resourceId":resource,"jetsamId":123,
            "reserved":[0,0,0],"startNs":1,"endNs":2,**(bad or {})}

usage = {"rc":0,"errno":0,"startAbstime":leaf["startAbstime"],"exitAbstime":0,
         "rss":leaf["nativeRss"],"user":leaf["nativeCpuUser"],"system":leaf["nativeCpuSystem"]}
esrch = copy.deepcopy(leaf["minimalFinal"])
assert esrch["errno"] == errno.ESRCH and esrch["bytes"] == 0

class FixtureNative:
    def __init__(self,second,second_cid,path1,path2,u):
        self.uid=uid;self.abi={"bsdSize":136};self.bsd_values=[first,second];self.cid_values=[fake_cid(),second_cid]
        self.path_values=[path1,path2];self.u=u;self.calls=[]
    def bsd(self,p):
        assert p==ownpid;self.calls.append("bsd");return self.bsd_values.pop(0)
    def coalition_id(self,p):
        assert p==ownpid;self.calls.append("cid");return self.cid_values.pop(0)
    def usage(self,p):
        assert p==ownpid;self.calls.append("usage");return self.u
    def path(self,p):
        assert p==ownpid;self.calls.append("path");return self.path_values.pop(0)
    def bsd_ok(self,b,p):
        return original.ScopeNative.bsd_ok(self,b,p)
    def born(self,b):
        return original.ScopeNative.born(self,b)

one = "/synthetic-own/one-plain-path-must-not-persist"
two = "/synthetic-own/two-plain-path-must-not-persist"
def path(p):
    return (len(p),0,p)

def run_control(second=good_second,second_cid=None,path1=None,path2=None,u=None,rss=None,expect_kind=None):
    second_cid = second_cid or fake_cid()
    path1 = path1 or path(one)
    path2 = path2 or path(one)
    u = u or usage
    values=[]
    for cls in (original.Collector, amended.Collector):
        # Object allocation does not invoke the collector/native constructor.
        collector=object.__new__(cls)
        collector.n=FixtureNative(second,second_cid,path1,path2,u)
        collector.cid=cidnum;collector.bundle="/synthetic-bundle";collector.cli="/synthetic-cli";collector.cohortRoot="/synthetic-scope";collector.knownInstrumentPaths={}
        def memory(_pid):
            assert _pid==ownpid
            if rss is not None:raise rss(_pid)
            return SimpleNamespace(memory_info=lambda:SimpleNamespace(rss=leaf["rss"]))
        with patch.object(amended.psutil,"Process",memory):
            value=collector.exact_row(ownpid,ownparent)
        values.append((value,collector.n.calls))
    ((oldrow,oldgap),oldcalls),((newrow,newgap),newcalls)=values
    assert newcalls == oldcalls, (oldcalls,newcalls)
    assert oldrow == newrow
    if expect_kind is None:
        assert oldgap is None and newgap is None and newrow
        return None
    assert oldgap["kind"] == newgap["kind"] == expect_kind
    assert oldgap == {k:v for k,v in newgap.items() if k != "diagnostic"}
    d = newgap["diagnostic"]
    assert d["observationsOnly"] and d["first"]["bsd"]["sameBirth"] and d["first"]["cid"]["matchesOwnedResource"]
    assert d["expectedParentPid"]==ownparent and d["firstParentMatchesExpected"]
    serialized=json.dumps(d)
    assert one not in serialized and two not in serialized
    # Diagnostic fields are not sufficient to reclassify the original
    # unknown failure. Original recognized ESRCH kinds are unchanged only.
    if expect_kind not in ("candidate-all-esrch","candidate-identity-disappeared"):
        assert retry_gap_classification({"gaps":[newgap]})[0] is None
    return d

controls=[]
assert run_control() is None;controls.append("stable actual-function return unchanged; exact same native call sequence")
d=run_control(path2=path(two),expect_kind="identity-raced-after-owned-binding")
assert d["second"]["bsd"]["sameBirth"] and d["second"]["cid"]["matchesOwnedResource"] and d["pathHashEqual"] is False
assert d["second"]["path"]["sha256"]==hashlib.sha256(two.encode()).hexdigest()
controls.append("synthetic same-birth valid CID second executable hash mismatch captured, still fatal")
d=run_control(second=esrch,second_cid=fake_cid(bad={"bytes":0,"errno":errno.ESRCH,"resourceId":0}),expect_kind="identity-raced-after-owned-binding")
assert d["second"]["bsd"]["errno"]==errno.ESRCH and not d["second"]["bsd"]["sameBirth"] and d["second"]["path"]=={"observed":False}
controls.append("synthetic second ESRCH and skipped path explicit; unknown original kind still fatal")
d=run_control(second_cid=fake_cid(resource=8888888),expect_kind="identity-raced-after-owned-binding")
assert d["second"]["cid"]["valid"] and not d["second"]["cid"]["matchesOwnedResource"] and "ownedResourceId" not in d["second"]["cid"] and d["second"]["path"]=={"observed":False}
assert "8888888" not in json.dumps(d)
controls.append("synthetic foreign CID redacted and path not queried, still fatal")
foreign={**good_second,"uid":9876543,"birthSec":7654321,"ppid":6543210}
d=run_control(second=foreign,expect_kind="identity-raced-after-owned-binding")
assert not d["second"]["bsd"]["ownUidMatches"] and not d["second"]["bsd"]["validOwnBsd"] and not d["second"]["bsd"]["sameBirth"]
assert all(str(v) not in json.dumps(d) for v in (9876543,7654321,6543210))
controls.append("synthetic wrong UID/birth/parent redacted; no further path, still fatal")
d=run_control(path2=(0,errno.EACCES,None),expect_kind="identity-raced-after-owned-binding")
assert d["second"]["path"]=={"observed":True,"rc":0,"errno":errno.EACCES,"returned":False,"sha256":None}
controls.append("synthetic path errno/nonreturn distinguished from path not queried, still fatal")
d=run_control(second=esrch,path1=(0,errno.ESRCH,None),u={**usage,"rc":-1,"errno":errno.ESRCH},expect_kind="candidate-identity-disappeared")
assert d["first"]["usage"]["errno"]==errno.ESRCH and d["second"]["bsd"]["errno"]==errno.ESRCH and not d["second"]["cid"]["observed"]
controls.append("synthetic original recognized ESRCH branch retains raw gap plus fields; no new class")
for exception in (amended.psutil.NoSuchProcess, amended.psutil.AccessDenied):
    d=run_control(rss=exception,expect_kind="rss-unreadable-after-owned-binding")
    assert d["rssException"]==exception.__name__ and not d["second"]["bsd"]["observed"]
controls.append("synthetic RSS NoSuchProcess and AccessDenied distinguished, both fatal as before")

new_files=["own_scope_native_diagnostic.py","scope_mismatch_diagnostics.py","run-scope-diagnostic.mjs","launch-scope-diagnostic.mjs","wrapper-scope-diagnostic.m","cleanup-scope-diagnostic.py","scope-diagnostic-preflight.py"]
for name in [n for n in new_files if n.endswith(".py")]:ast.parse((base/name).read_text())
for name in [n for n in new_files if n.endswith(".mjs")]:subprocess.run(["node","--check",str(base/name)],check=True)
subprocess.run(["/usr/bin/clang","-fsyntax-only",str(base/"wrapper-scope-diagnostic.m")],check=True)
cdp = json.loads(subprocess.check_output(["node",str(repo/"scripts/lib/check-cdp-expressions.mjs"),str(base/"run-scope-diagnostic.mjs"),str(base/"electron-harness.mjs")],text=True))
assert cdp["failures"] == 0 and cdp["executed"] is False
print(json.dumps({
    "schema":"B11-C28-scope-mismatch-diagnostic-preflight","staticOnly":True,"newAppRun":False,"newNativeObservation":False,
    "actualSources":{str(p.relative_to(repo)):sha(p) for p in (r4path,r5path,c22path,c22old,c27path)},
    "actualR5":{"scopeVerdict":"fatal","gap":failed5["gaps"][0],"beforeAndAfterOwnMember":before[0],"exactDirectParent":parent,"stillInBothParentInventories":True,"uidCounts":[35,35],"nativeGraphCount":34,"counterStarts":[3054,3055],"counterExits":[3019,3020],"specificNativeReturnAbsent":True,"noProvenDisappearance":True},
    "actualC22EarlierBareGap":old["gaps"][0],"actualAcceptedEndpointsUnchanged":actual_counts,
    "actualC22RecognizedESRCHAndLaterClosedEndpoint":actual_esrch,
    "syntheticActualFunctionControls":controls,"originalR5SourcePinsUnchanged":True,
    "originalExactRowNativeCallCountAndSequenceUnchangedInControls":True,"originalCaptureAndUidAndAdjudicationUnchanged":True,
    "formalEligible":False,"noNewRetry":True,"syntax":{"pythonAst":True,"nodeCheck":True,"clangSyntaxOnly":True,"cdp":cdp},"files":{n:sha(base/n) for n in new_files}
},ensure_ascii=False,indent=2))
