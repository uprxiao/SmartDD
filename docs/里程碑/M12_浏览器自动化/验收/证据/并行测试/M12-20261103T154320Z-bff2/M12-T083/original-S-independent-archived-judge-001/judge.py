from pathlib import Path
import json,hashlib,sys
base=Path(sys.argv[1]).resolve();m=json.loads((base/"manifest.json").read_text());members={x["path"]:x for x in m.get("files",[])+m.get("reusedPublicFiles",[])}
def read(name):
 x=members[name];p=(base/x.get("publicPath",x["path"])).resolve();assert hashlib.sha256(p.read_bytes()).hexdigest()==x["sha256"];return json.loads(p.read_text())
checks={};branches=[];packages=[]
for n in ["006","007"]:
 a=read("App"+n+"/raw.safe.json");c=read("App"+n+"/cleanup.json");p=read("App"+n+"/pin.json");packages.append((p["sourceManifestSha256"],p["asarSha256"]))
 assert a["normalExitConfirmed"] and a["appExit"]["code"]==0 and a["appExit"]["signal"] is None and not a["cleanupErrors"] and not a["observedProcess"]["signals"] and c["allClear"]
 assert a["productionHooks"]==0 and a["models"]==0 and a["stockCLICommands"]==0 and a["sourceIsolation"]["mockKeychainSwitch"] is False and a["sourceIsolation"]["homeMatches"]
 assert a["hostEncryptionControl"]["available"] and a["hostEncryptionControl"]["roundTripMatches"]
 for k in a["checks"]:
  s=next(x for x in a["steps"] if x["family"]==k["family"] and x["decision"]==k["decision"]);u=s["userDecision"];assert u["observedBy"]=="user-live" and u["promptShown"] is True and u["decision"]==k["decision"] and s["confirmClickDispatchedAt"] and k["realSystemUserConfirmed"]
  assert u["service"]==("Chrome Safe Storage" if k["family"]=="chrome" else "Microsoft Edge Safe Storage")
  if k["decision"]=="deny":assert k["noTargetWrite"] is True and s["before"]["canonicalHash"]==s["after"]["canonicalHash"] and s["resultUI"]["title"]=="导入未完成" and "钥匙串" in s["resultUI"]["text"] and "超时" not in s["resultUI"]["text"]
  else:assert k["realCookieEffective"] is True and not s["before"]["controlledMatches"] and s["after"]["controlledMatches"] and s["resultUI"]["title"]=="导入完成" and s["serverCookieFact"][k["family"]+"Present"] is True
  branches.append((k["family"],k["decision"]))
 checks["App"+n+"NormalAndIndependentClear"]=True
assert len(set(packages))==1 and len(branches)==4 and set(branches)=={("chrome","deny"),("chrome","allow"),("edge","deny"),("edge","allow")}
a=read("App006/raw.safe.json");assert a["status"]=="failed-or-partial" and a["failure"] and len(a["checks"])==1;assert not a["steps"][1]["confirmClickDispatchedAt"]
b=read("chrome-ACL/baseline.json")["baseline"];r=read("chrome-ACL/restoration.json");v=r["restoredObservedSettings"];assert r["restorationPending"] is False and set(v["alwaysAllowedApplications"])==set(b["alwaysAllowedApplications"]) and len(v["alwaysAllowedApplications"])==len(b["alwaysAllowedApplications"])
assert all(v[k]==b[k] for k in ["allowAllApplications","confirmBeforeAccess","askKeychainPassword","saveChangesEnabled"])
assert read("source-resume/final-source-cleanup.json")["allClear"]
for family in ["chrome","edge"]:
 x=read(family+"-seed-result.json");y=read(family+"-real-cdp-result.json");assert x["realBrowserCreatedEncryptedCookie"] and x["exitCode"]==0 and x["normalCDPBrowserClose"] and y["persistentCookie"] and y["realServerReceivedCookie"]
 assert all(t[2]==0 and t[3]>3 and t[4]=="763130" for t in x["cookieMetadata"])
checks.update({"sameSourceAndPackage":True,"fourOriginalSystemBranches":True,"actualNativeUserDecisions":True,"bothDenialsNoWrite":True,"bothAllowsNativeAndHTTP":True,"realBrowserEncryptedSources":True,"productionSourceAndHostCipherUnmocked":True,"originalLaterDriverFailurePreserved":True,"originalACLRestoredByUserAndNativeAXVerified":True,"sourceResourcesCleared":True})
out={"case":"M12-T083","layer":"S","allPassed":all(checks.values()),"checks":checks,"evidenceManifestSHA256":hashlib.sha256((base/"manifest.json").read_bytes()).hexdigest(),"formalUniqueCaseIncrement":1,"scope":"Original four branches only; clipboard non-use statements refer only to agent automation, not user clipboard state; no mock/CLI/model substitution"}
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n");print(json.dumps({"allPassed":out["allPassed"],"checks":len(checks),"formalUniqueCaseIncrement":1}));raise SystemExit(0 if out["allPassed"] else 1)
