from pathlib import Path
import hashlib,json,datetime,os,subprocess,time
root=Path('/private/tmp/willyou-m11-c23-2637');source=root/'software-source-attempt-002';out=root/'software-evidence/attempt-003-preparation'
manifest_path=root/'source-manifest.json';delta_path=root/'test-only-corrections.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
assert not (out/'result.json').exists(),'Do not overwrite completed preparation'
assert sha(manifest_path)=='b5b62e1758ae526a4eea48c18070c7d8fe1ef1e615fa34a73f24c06245e0fcb0'
manifest=json.loads(manifest_path.read_text());delta=json.loads(delta_path.read_text());allowed={r['path']:r for r in delta['changes']}
assert len(allowed)==4 and all(p.endswith('.test.ts') for p in allowed)
rows=[];unexpected=[];matches=[]
for row in manifest['files']:
 p=source/row['path'];actual=sha(p);size=p.stat().st_size
 if row['path'] in allowed:
  change=allowed[row['path']];assert row['sha256']==change['beforeSha256'] and actual==change['afterSha256'],row['path'];matches.append(row['path'])
 elif actual!=row['sha256'] or size!=row.get('size',row.get('bytes')):unexpected.append(row['path'])
 rows.append({'path':row['path'],'size':size,'sha256':actual})
assert len(matches)==4 and not unexpected,unexpected
original_names={r['path'] for r in manifest['files']};extra_inputs=[]
for directory,subdirs,files in os.walk(source):
 subdirs[:]=[n for n in subdirs if n not in ['node_modules','out','.git']]
 for filename in files:
  name=str((Path(directory)/filename).relative_to(source))
  if name not in original_names:extra_inputs.append(name)
production_extras=[n for n in extra_inputs if n.startswith(('src/','resources/','scripts/','native/','prototypes/')) or (len(Path(n).parts)==1 and Path(n).suffix in ['.json','.ts','.js','.mjs','.cjs','.yaml','.yml'])]
external_test_drivers={'scripts/applications/m11-t17-foxmail-v2-ui.mjs'}
confirmed_external=[{'path':n,'sha256':sha(source/n),'classification':'Coordinator-confirmed external T17 UI test driver; excluded from production inputs and packaging; not executed'} for n in extra_inputs if n in external_test_drivers]
production_extras=[n for n in production_extras if n not in external_test_drivers]
assert not production_extras,production_extras
write('corrected-source-inputs.json',{'source':str(source),'originalManifestSha256':sha(manifest_path),'testCorrectionSha256':sha(delta_path),'files':rows})
env={**os.environ,'WILLYOU_TEST_CACHE_DIR':str(root/'software-cache-final'),'COREPACK_ENABLE_NETWORK':'0'}
start=time.monotonic();argv=['pnpm','typecheck'];timed=False
with (out/'typecheck.log').open('wb') as log:
 p=subprocess.Popen(argv,cwd=source,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 execution={'argv':argv,'cwd':str(source),'pid':p.pid,'processGroup':p.pid,'startedAt':now(),'outerBudgetSeconds':180};write('execution.json',execution);print(json.dumps({'event':'started',**execution}),flush=True)
 try:code=p.wait(timeout=180)
 except subprocess.TimeoutExpired:
  timed=True;os.killpg(p.pid,15)
  try:code=p.wait(timeout=10)
  except subprocess.TimeoutExpired:os.killpg(p.pid,9);code=p.wait()
execution.update({'exitCode':code,'timedOut':timed,'elapsedSeconds':round(time.monotonic()-start,3),'finishedAt':now()});write('execution.json',execution)
after=[r['path'] for r in rows if not (source/r['path']).is_file() or (source/r['path']).stat().st_size!=r['size'] or sha(source/r['path'])!=r['sha256']]
try:os.killpg(p.pid,0);alive=True
except ProcessLookupError:alive=False
write('cleanup.json',{'at':now(),'ownProcessGroup':p.pid,'ownProcessGroupStillExists':alive,'allOwnProcessesStopped':not alive,'nativeOrUiLeaseUsed':False,'fullSuiteOrReleaseTestStarted':False,'realAgentOrModelStarted':False,'sourceOrPublicLedgerWritten':False,'sourceDrift':after})
write('result.json',{'schema':'willyou-software-preparation-v1','status':'passed' if code==0 and not timed and not after and not alive else 'failed','correctedSource':str(source),'oldSourceRead':False,'baselineManifestReadOnly':str(manifest_path),'baselineSourceFiles':len(rows),'testCorrectionSha256':sha(delta_path),'fourTestFileHashesMatched':matches,'otherOriginalInputsUnchanged':len(rows)-len(matches),'unexpectedChangesOutsideFourTests':unexpected,'extraNonProductionInputs':extra_inputs,'confirmedExternalTestDrivers':confirmed_external,'extraProductionInputs':production_extras,'productionUnchangedProof':'All original inputs outside exactly four .test.ts files match original manifest SHA and size; no additional production input path found. No old source was executed/read for a rerun.','correctedInputManifestSha256':sha(out/'corrected-source-inputs.json'),'execution':execution,'sourceDriftAfterTypecheck':after,'cache':str(root/'software-cache-final'),'formalUniqueCasesAdded':0,'heavyTestsStarted':False,'pending':'Wait for a new heavy/UI resource allocation before full suite or test:release.'})
files=[{'path':f.name,'bytes':f.stat().st_size,'sha256':sha(f)} for f in sorted(out.iterdir()) if f.is_file() and f.name!='manifest.json'];write('manifest.json',{'schema':'willyou-evidence-manifest-v1','group':'V010-SOFTWARE-preparation','attempt':3,'files':files})
print(json.dumps({'event':'sealed','typecheckExitCode':code,'elapsedSeconds':execution['elapsedSeconds'],'changedTestFiles':len(matches),'otherInputsUnchanged':len(rows)-len(matches),'sourceDrift':after,'ownProcessGroupStillExists':alive,'manifestSha256':sha(out/'manifest.json')}),flush=True)
