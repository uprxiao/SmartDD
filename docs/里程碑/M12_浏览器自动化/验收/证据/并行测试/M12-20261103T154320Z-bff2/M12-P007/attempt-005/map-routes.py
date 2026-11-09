from pathlib import Path
import json,hashlib,datetime,difflib
R=Path('/private/tmp/willyou-m12-t065-executor-001/attempt-005');P=R.parent
read=lambda n:json.loads((R/n).read_text())
write=lambda n,v:(R/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
functions=read('function-comparisons.json')['comparisons'];files=read('file-comparisons.json')['comparisons'];fragments=read('semantic-label-path.json')['fragments'];mapping=json.loads((P/'attempt-004/conditional-original-matrix-evidence.json').read_text())['mapping']
components={}
def fn(path,name):
 row=next(x for x in functions if x['path']==path and x['function']==name);key=path+'::'+name;components[key]={'kind':'exact original function bytes',**row};return key
def file(path):
 row=next(x for x in files if x['path']==path);key=path;components[key]={'kind':'complete unchanged file',**row};return key
def fragment(name):
 row=next(x for x in fragments if x['fragment']==name);key='label-path::'+name;components[key]={'kind':'exact original dispatch-path fragment',**row};return key
A='cli/src/native/actions.rs';I='cli/src/native/interaction.rs'
base=[file('cli/src/main.rs'),file('cli/src/commands.rs'),file('cli/src/connection.rs'),fn('cli/src/commands.rs','parse_find'),fn(A,'execute_command'),fn(A,'execute_subaction'),fn(A,'success_response'),fn(A,'error_response')]
role=[fn(A,'handle_getbyrole'),fn(A,'build_role_selector')]
label=[fn(A,'handle_getbylabel'),fragment('semantic_prefix'),fragment('semantic_label_branch'),fragment('semantic_suffix')]
nth=[fn(A,'handle_nth')]
for name in ['click','fill','type_text','hover','focus','check','uncheck'] :fn(I,name)
unchanged=[x['path']for x in files if x['allEqual']]
action_fn={'click':'click','fill':'fill','type':'type_text','hover':'hover','focus':'focus','check':'check','uncheck':'uncheck'}
missing={'literal-text-name','literal-text-exact','literal-title-name','literal-title-exact'}
rows=[]
for entry in mapping:
 rawfile=P/entry['caseFile'];b=rawfile.read_bytes();assert hashlib.sha256(b).hexdigest()==entry['caseFileSha256'];raw=json.loads(b);revision={ 'attempt-002':'.2','attempt-003':'.3','attempt-004':'.4'}[entry['evidenceAttempt']];locator=raw['locator'];action=raw['action'];refs=list(base);explanation=[]
 if locator=='role':refs+=role;explanation.append('native parse_find maps role to getbyrole; whole role query/name/exact/accessibility matching and marker cleanup functions byte-identical')
 elif locator=='label':refs+=label;explanation.append('label branch plus prefix/error/transport/action/cleanup suffix byte-identical; changed match_fn string is unused for label, as shown in semantic-label-path.json')
 elif locator in ['first','last','nth']:refs+=nth;explanation.append('parse_find maps first/last to nth index0/-1 and nth to explicit index; parser, nth query/dispatch/cleanup functions byte-identical')
 else:refs+=[fn(A,'handle_semantic_locator')];explanation.append('text or attribute branch changed in .4; only fresh .4 evidence proves current branch for the actual original scene')
 if entry['id']=='iframe-label-fill':
  outcome='reusable-under-declared-limit';explanation.append('Controlled outer fixture contains only iframe, no outer label/aria-label/aria-labelledby. Label query uses only document and cannot enter iframe; false result returns before execute_subaction/fill. Native original error/unchanged child/no input evidence retained. Thus changed .2 fill is not part of this observed failure path.')
 elif entry['id']in missing:
  outcome='needs-current-version-native-supplement';refs+=[fn(I,'fill')];explanation.append('Parser, common execute_subaction and .3 fill match .4, but the actual .3 text/title locator branch is not byte-identical to .4. These four need attempt006 actual native evidence; no static full-path pass claimed.')
 else:
  refs+=[fn(I,action_fn[action])];outcome='fresh-current-version-evidence'if revision=='.4'else'reusable-byte-identical-path'
  # Only the exact selected dispatch path is asserted, never a changed whole
  # locator function used by a different strategy.
  for key in refs:
   c=components[key];assert c['sha256'][revision]==c['sha256']['.4'],(entry['id'],key)
 checks=[]
 for key in refs:
  c=components[key];checks.append({'component':key,'evidenceSha256':c['sha256'][revision],'currentSha256':c['sha256']['.4'],'byteEqual':c['sha256'][revision]==c['sha256']['.4']})
 rows.append({**entry,'locator':locator,'action':action,'evidenceRevision':revision,'targetRevision':'.4','recommendation':outcome,'componentChecks':checks,'pathNotes':explanation,'dependencyClosure':'Every other CLI source/protocol/build input is globally byte-identical; only semantic locator/literal_attribute_query/fill differ. Cargo changes only root version. This is scoped static reuse evidence, not native reexecution or formal whole-program verification.'})
assert len(rows)==75
counts={name:sum(x['recommendation']==name for x in rows)for name in sorted(set(x['recommendation']for x in rows))}
write('route-components.json',{'at':now(),'components':components,'globallyByteIdenticalFiles':unchanged,'fullSourceAndDifferences':'sources/*/cli and file-comparisons.json; all80 files reconstructed from original archive plus exact archived patch'})
write('case-route-reuse-proof.json',{'at':now(),'originalScenes':75,'recommendationCounts':counts,'remainingNativeGaps':sorted(missing),'scenes':rows})
# Retain exact full-source diffs as a compact review aid; original files are
# already retained, so the proof is not based solely on these diff sections.
(R/'full-source-diffs').mkdir(exist_ok=True)
for old,new in [('2','3'),('3','4')]:
 for path in ['cli/src/native/actions.rs','cli/src/native/interaction.rs','cli/Cargo.toml','cli/Cargo.lock']:
  a=(R/'sources'/old/path).read_text();b=(R/'sources'/new/path).read_text();diff=''.join(difflib.unified_diff(a.splitlines(keepends=True),b.splitlines(keepends=True),fromfile=old+'/'+path,tofile=new+'/'+path));(R/'full-source-diffs'/f'{old}-to-{new}-{path.replace("/","_")}.diff').write_text(diff)
cleanup={'at':now(),'mode':'static source/evidence reads and private files only','nativeStarted':False,'appStarted':False,'ptyStarted':False,'listenersStarted':False,'buildStarted':False,'resourcesClaimed':False,'processesToClean':[],'hooksInstalled':False}
write('cleanup.json',cleanup)
write('result.json',{'at':now(),'caseId':'M12-T065','layer':'U static source reuse audit','status':'partial-current-version-evidence','originalScenes':75,'currentVersionEvidenceReady':71,'needsNativeSupplement':4,'remainingGapIds':sorted(missing),'counts':counts,'sourceProvenance':'source-provenance.json and historical-build-provenance.json','sourcesVerifiedPerRevision':80,'parserTransportAndSharedDispatch':'main.rs/commands.rs/connection.rs and execute_command/execute_subaction exact across all three revisions','actionScope':'Only fill changes .2→.3, identical .3→.4. Only semantic locator/attribute query changes .3→.4; role/label/first/last/nth selected paths unchanged.','iframeScope':'Declared no-find-in-iframe failure evidence reusable on same label failure path; no invocation of old fill is assumed. Skill exact same in .2/.3/.4.','binaryBoundary':'Original .2 build.log+manifest binds b51f actual frozen helper to exact patch/upstream; original T052 actual hash matches. Current .2 target artifact differs and is explicitly excluded; no inference of difference cause.','wholeCaseRecommendation':'Do not count whole T065 green from this static delivery. After four attempt006 actual native scenes pass and coordinator verifies these proofs, combine71 existing+4 fresh current-version scenes. Native A/R or whole-case account remains coordinator responsibility.','productionOrPublicLedgerOrOldDeliveryChanges':False,'nativeOrBuildExecuted':False})
print(json.dumps({'originalScenes':75,'counts':counts,'ready':71,'gaps':sorted(missing),'components':len(components)},ensure_ascii=False))
