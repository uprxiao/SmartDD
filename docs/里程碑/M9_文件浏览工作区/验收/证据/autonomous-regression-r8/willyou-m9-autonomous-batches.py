from pathlib import Path
import json,os,subprocess,sys
root=Path('/Users/hx/hx/hxWork/SmartDD'); app='/private/tmp/willyou-m9-acceptance-batch-r7-build/mac-arm64/WillYou.app'; broker=app+'/Contents/Resources/native/willyou-files'
env=os.environ.copy(); env['PATH']='/private/tmp/willyou-89de9af-python/bin:'+env['PATH']
for key in ['DRAFT','LIFECYCLE','MARKDOWN_REFRESH','SEARCH','WATCH_ACCEPTANCE','TERMINAL','ATTACHMENT','CLEAN_REFRESH','TEXT_DISK','NONLOCAL']:env['SMARTDD_'+key+'_APP']=app
for key in ['M9_FILE_BROKER','SECURITY_BROKER','F10_BROKER','REGISTRY_BROKER','LSP_BROKER','FILES_NATIVE_PATH']:env['SMARTDD_'+key]=broker
env['SMARTDD_TREE_FIXTURES']='/private/tmp/willyou-tree-basic/fixtures.json'
mode=sys.argv[1]
if mode=='integration':
 report=json.load(open('/private/tmp/willyou-m9-autonomous-regression-r2.json'))
 tests=[str(Path(f['name']).relative_to(root)) for f in report['testResults'] if any(t['status']=='skipped' for t in f['assertionResults']) and '/files/' in f['name'] and not any(x in f['name'] for x in ['/tex/native.test','/office/native.test','/office/libreoffice-native.test','/office/libreoffice-packaged.test','routing-basic-acceptance'])]
 tests+=['src/main/core/capabilities/resource-execution.test.ts']
elif mode=='engines':
 for key in ['TEX_NATIVE','OFFICE_NATIVE','LIBREOFFICE_NATIVE']:env['SMARTDD_M9_'+key]='1'
 env['SMARTDD_M9_OFFICE_PACKAGE']=app;env['SMARTDD_M9_LIBREOFFICE_APP']=app;env['SMARTDD_M9_PDFTEXT']='/opt/homebrew/bin/pdftotext'
 env['SMARTDD_M9_OFFICE_EVIDENCE']='/private/tmp/willyou-m9-autonomous-engine-evidence';Path(env['SMARTDD_M9_OFFICE_EVIDENCE']).mkdir(exist_ok=True)
 tests=['src/main/core/files/tex/native.test.ts','src/main/core/files/office/native.test.ts','src/main/core/files/office/libreoffice-native.test.ts','src/main/core/files/office/libreoffice-packaged.test.ts']
else:raise ValueError(mode)
prefix='/private/tmp/willyou-m9-autonomous-'+mode
command=['pnpm','test',*tests,'--maxWorkers=2','--reporter=json','--outputFile='+prefix+'.json']
Path(prefix+'-command.json').write_text(json.dumps({'command':command,'environment':{k:v for k,v in env.items() if k.startswith('SMARTDD_')},'pythonPathPrefix':'/private/tmp/willyou-89de9af-python/bin','appIsGUIAcceptance':False},indent=2)+'\n')
print(mode,len(tests),'files',flush=True)
with open(prefix+'.log','w') as log:status=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
print('exit',status,flush=True)
sys.exit(status)
