"""Current App038 pure-file binding checks. No executable/process/network invocation."""
from pathlib import Path
import ast,copy,hashlib,json,plistlib,re,struct,os
ROOT=Path(__file__).parent
SOURCE=Path('/private/tmp/willyou-m12-park-menu-source-045/source-inputs.json')
BUILD=Path('/private/tmp/willyou-m12-park-menu-App038-build-001/result.json')
APP=Path('/private/tmp/willyou-m12-s2-package-038/mac-arm64/WillYou.app')
def sha(p):
 h=hashlib.sha256()
 with Path(p).open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def check_shape(v):
 assert v['root']==str(ROOT) and v['app']==str(APP)
 assert v['source']==str(SOURCE) and v['sourceSHA']=='226e75149302ef748c2bbed5b97dc26183d5dd93dfc291b21e8c0b6331714cb6'
 assert v['build']==str(BUILD) and v['buildSHA']==sha(BUILD)
 assert v['asar']==sha(APP/'Contents/Resources/app.asar') and v['exe']==sha(APP/'Contents/MacOS/WillYou')
 assert v['installedFinalReady']is False and v['installGate']is None and v['nativeGate']is None
 assert v['Electron']=='42.11.14'
 return True
def check_parent_facts(facts,expected):
 assert list(facts)==expected
 assert all(row['directory']and not row['symlink']and row['owned']for row in facts.values())
 return True
def packed_main():
 with (APP/'Contents/Resources/app.asar').open('rb')as f:
  head=f.read(16);_,header_size,_,json_size=struct.unpack('<IIII',head);data=f.read(json_size);j=json.loads(data);node=j['files']['out']['files']['main']['files']['index.js'];f.seek(8+header_size+int(node['offset']));b=f.read(node['size'])
 return {'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'scope':'ActualcurrentASARpackedmain read only; no renderer equivalence inferred'}
def check_prebinding():
 assert json.loads((ROOT/'binding.json').read_text())['ready']is False
 assert not(ROOT/'first-six-state.json').exists() and not(ROOT/'installed-startup-001/execution-started.json').exists()
 syntax=[]
 for p in sorted(ROOT.rglob('*.py')):
  if any(x in p.parts for x in ['node_modules','cache','binding-schema-review-001']):continue
  ast.parse(p.read_text(),filename=str(p));syntax.append({'path':str(p.relative_to(ROOT)),'sha256':sha(p)})
 binder=(ROOT/'bind-App038-inputs.py').read_text();tree=ast.parse(binder)
 assert not any(isinstance(n,ast.Import)and any(a.name in ['subprocess','ctypes','socket']for a in n.names) for n in ast.walk(tree))
 assert 'WILLYOU_APP038_INPUT_BINDING_CONFIRMED'in binder and "'runner-manifest.json','input-binding-receipt.json','bound-input-manifest.json'"in binder
 assert 'check_prebinding()'in binder
 source=json.loads(SOURCE.read_text());build=json.loads(BUILD.read_text());adapter=json.loads((ROOT/'official-build-input-adapter.json').read_text())
 assert sha(SOURCE)=='226e75149302ef748c2bbed5b97dc26183d5dd93dfc291b21e8c0b6331714cb6'
 assert build['exitCode']==0 and build['sourceShaModeBeforeAfterMatched']and build['sourceFiles']==3691
 assert adapter['officialResult']=={'path':str(BUILD),'sha256':sha(BUILD)}
 proof=adapter['fieldSources']['nativeSmoke'];log=Path(proof['path']);lines=log.read_text().splitlines();assert sha(log)==proof['sha256'];line=lines[proof['line']-1];assert hashlib.sha256(line.encode()).hexdigest()==proof['lineSHA256'];smoke=json.loads(line);assert all(smoke[k]=='passed'for k in['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher']);assert (smoke['version'],smoke['platform'],smoke['arch'])==('0.1.1','darwin','arm64')
 start=ROOT/'installed-startup-001';pin=json.loads((start/'pin.template.json').read_text());ready=json.loads((start/'execution-ready.json').read_text());assert ready['actualInstallationAndNativeBound']is False and ready['initialFocusRequired']is False
 v={'root':str(ROOT),'app':str(APP),'source':str(SOURCE),'sourceSHA':sha(SOURCE),'build':str(BUILD),'buildSHA':sha(BUILD),'asar':build['pins']['app.asar'],'exe':build['pins']['executable'],'installedFinalReady':pin['finalReady'],'installGate':pin['buildGate']['sha256'],'nativeGate':pin['nativeGate']['sha256'],'Electron':plistlib.loads((APP/'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist').read_bytes())['CFBundleVersion']}
 assert check_shape(v);negative=[]
 changes=[('root','/private/tmp/willyou-m12-app031-installer-001'),('app','/private/tmp/willyou-m12-s2-package-031/mac-arm64/WillYou.app'),('sourceSHA','88dfe535e049ce40211777014a1829deee8d295b9c452ffb82b87cd46e42b6da'),('buildSHA','0'*64),('asar','cadb8e9944cfddb86ce7055de8064c6069e794843024eadc5275e4a4e848dbea'),('exe','93bdd688d89060213b2e15c2a638098c5e5fced273c06e68333d83917e987aa1'),('installedFinalReady',True),('installGate','old'),('nativeGate','old'),('Electron','42.0.0')]
 for key,value in changes:
  bad={**v,key:value}
  try:check_shape(bad)
  except AssertionError:negative.append(key)
  else:raise AssertionError('Currentbindingnegativeadmitted:'+key)
 baseline=json.loads((ROOT/'cached-baseline-reference.json').read_text());assert sha(Path(baseline['path']))==baseline['sha256']
 parents=json.loads((ROOT/'directory-shape.json').read_text())['precreatedParentsOnly'];facts={rel:{'directory':(ROOT/rel).is_dir(),'symlink':(ROOT/rel).is_symlink(),'owned':(ROOT/rel).resolve().is_relative_to(ROOT)}for rel in parents};assert check_parent_facts(facts,parents);parentNegative=[]
 for missing in parents:
  bad=copy.deepcopy(facts);bad[missing]['directory']=False
  try:check_parent_facts(bad,parents)
  except AssertionError:parentNegative.append(missing)
  else:raise AssertionError('Missing declared parent admitted:'+missing)
 for rel in json.loads((ROOT/'directory-shape.json').read_text())['requiredAbsent']:assert not(ROOT/rel).exists() and not(ROOT/rel).is_symlink(),rel
 for row in json.loads((ROOT/'inherited-proof-references.json').read_text())['files']:assert sha(ROOT/row['path'])==row['sha256']
 report={'allPassed':True,'checkerPID':os.getpid(),'precreatedParents':facts,'missingParentNegative':parentNegative,'scope':'Pure AST/currentvalues/filehash/oldvalue-negative controls, not Native/install/App','pythonAST':syntax,'valuePositive':1,'valueNegative':negative,'actualSourceSHA256':sha(SOURCE),'actualBuildSHA256':sha(BUILD),'actualCurrentMain':packed_main(),'NativeAppOSPTYHTTPMountBuildCLIModel':0,'historicalStaticBytesPreserved':True,'cache':'PrivateRootOnly'}
 (ROOT/'current-static-App038.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');return report
if __name__=='__main__':print(json.dumps(check_prebinding(),ensure_ascii=False))
