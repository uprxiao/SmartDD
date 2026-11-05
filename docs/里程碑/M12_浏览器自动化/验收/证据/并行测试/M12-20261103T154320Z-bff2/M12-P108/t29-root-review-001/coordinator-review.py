from pathlib import Path
import json,hashlib,datetime,re
s=Path('/private/tmp/willyou-m12-t131-t29-sandbox-app022-002');a=Path('/private/tmp/willyou-m12-t131-t29-native-denial-review-001');o=Path('/private/tmp/willyou-m12-t131-t29-root-review-001');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((s/'actual-safe-001/manifest.json').read_text());assert len(m['files'])==14
for f in m['files']:
 p=s/'actual-safe-001'/f['path'];assert sha(p)==f['sha256'];assert p.stat().st_size==f['bytes'];assert f.get('safeForRepo',True)
er=json.loads((s/'execution-ready.json').read_text());assert len(er['inputs'])==213
for f in er['inputs']:
 p=s/f['path'];assert sha(p)==f['sha256'];assert p.stat().st_size==f['bytes'];assert (p.stat().st_mode&0o777)==f['mode']
original=(s/'oracle.mjs').read_text();derived=(a/'oracle-derived.mjs').read_text();n=derived
for add in ["import{verifyExactConfiguration}from'./config-proof.mjs';\n","import{nativeToolDenied}from'/private/tmp/willyou-m12-t131-t29-native-denial-review-001/native-denial.mjs';\n"]:
 assert n.count(add)==1;n=n.replace(add,'',1)
for name in ['exec-carrier','plan-reader','business-success','native-scope','probes','io','sop-pins','native-journal']:
 n=n.replace("'"+str(s/(name+'.mjs'))+"'","'./"+name+".mjs'")
assert n.count('function frozenNetworkProof(')==1;n=n.replace('function frozenNetworkProof(','export function networkProof(',1)
metadata='output:{...v.output,__t29NativeEvidence:{source,callId:pair.request.callId,callLine:pair.requestLine,outputLine:pair.outputLine,callAt:pair.requestedAt,at:pair.at}},'
assert n.count(metadata)==1;n=n.replace(metadata,'',1)
x='await verifyExactConfiguration(p,{read});';assert n.count(x)==1;n=n.replace(x,"assert.deepEqual(p.configBefore,p.configAfterTools,'Application does not modify original full private config bytes/mode');assert.deepEqual(p.configBefore,p.configAfterStop);",1)
x='all private policy/provider/project bytes and modes preserved; only exact Codex TUI counters advance1-to2, original full-file SHA differences retained';assert n.count(x)==1;n=n.replace(x,'full configuration bytes/mode unchanged after baseline-owned Codex initialization',1)
x='\nexport function networkProof(output,target,options={}){try{return frozenNetworkProof(output,target,options)}catch(originalError){return nativeToolDenied({output,target,options,originalError})}}\n';assert n.endswith(x);n=n[:-len(x)]
assert n==original,'Any undeclared oracle difference is a failure'
d=json.loads((o/'derived-case-review.json').read_text());assert d['passed'];assert d['phaseCount']==4;assert d['negativeControls']==13 and d['configNegativeControls']==15;assert len(d['exactNativePolicyDenials'])==6;assert all(x['childExitObserved'] is None for x in d['exactNativePolicyDenials'])
configs=d['exactPrivateConfigurationFacts'];assert len(configs)==3;assert sum(x['entireFileUnchanged'] for x in configs)==1
for x in configs:
 if not x['entireFileUnchanged']:assert x['exactMatchingBeforeHashReconstruction'] and x['everyOtherByteIdentical'] and x['beforeCounter']==1 and x['afterCounter']==2
r=json.loads((s/'raw.private.json').read_text());c=json.loads((s/'cleanup-verification.json').read_text());assert c['allClear'] and len(c['checks'])==33 and all(x['clear'] for x in c['checks'])
assert len(r['phases'])==4 and all(p['authFileAbsentAfter'] for p in r['phases']);assert r['appExit']['code']==0 and r['appExit']['signal'] is None and r['observedProcess']['signals']==[];assert not r['cleanupErrors'] and not r['persistenceErrors']
for pid in r['knownPids']:assert any(x.get('pid')==pid and x['clear'] for x in c['checks'])
for port in r['knownPorts']:assert any(x.get('port')==port and x['clear'] for x in c['checks'])
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'T29 current original policy compatibility evidenced; no parent whole pass','passed':True,'reviewMode':'file-only independent source/Native/plan replay; original actual not repeated','sourceSafeManifestSHA':sha(s/'actual-safe-001/manifest.json'),'inputsSHABytesModesVerified':213,'safeFilesVerified':14,'independentReversedOracleSHA':hashlib.sha256(n.encode()).hexdigest(),'originalOracleSHA':sha(s/'oracle.mjs'),'allOtherOracleBytesIdentical':True,'actualPhases':4,'actualToolCalls':40,'nativeErrorControls':13,'configControls':15,'nativeDenialExitsRemainNull':True,'policyFieldsAndAllOtherConfigBytesUnchanged':True,'twoExactCodexTUIOnlyByteChanges':'1 to 2, before fullSHA reconstruct matches; actual OS writer was not traced','normalExit':True,'cleanupChecks':33,'softwareEvidence':'current source026 effective-sandbox existing31passed/0skip; separate U/I','tokenIsolationEvidence':'current I + T38 actual other live run/tree outsider denied; no named-policy-specific concurrentB claim','networkBoundary':'Both named baseline and selected declared allowed domain were actually denied; fixture itself reachable outside sandbox. No public Internet/positive allowlist claim, existing C22 accepted narrowing retained. Default actual denied remains denied.','openFinding':'M12-NATIVE-CACHE-01 persists separately; no private-token-cache-absence claim','formalCaseIncrement':0}
(o/'coordinator-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');files=[{'path':p.name,'sha256':sha(p),'bytes':p.stat().st_size,'safeForRepo':True} for p in o.iterdir() if p.is_file()];(o/'manifest.json').write_text(json.dumps({'files':files,'scope':'Root T29 file-only strict replay and independent exact declared-delta reversal','secretValuesOrIndividualSecretHashesIncluded':False},ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['passed','actualPhases','actualToolCalls','cleanupChecks','inputsSHABytesModesVerified','allOtherOracleBytesIdentical','formalCaseIncrement']}))
