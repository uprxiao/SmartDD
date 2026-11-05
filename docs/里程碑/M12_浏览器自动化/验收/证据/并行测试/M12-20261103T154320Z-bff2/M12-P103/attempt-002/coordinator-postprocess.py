from pathlib import Path
import json,subprocess,os,time,datetime,hashlib,sys
root=Path(__file__).parent;payload=root/'payload';outer=json.loads((root/'raw.json').read_text());raw=json.loads((payload/'raw.json').read_text());assert outer['status']=='executed-unjudged-original1800s';assert not outer.get('cleanupUnresolved');assert raw['status']=='executed-unjudged';assert raw['normalExit']['code']==0 and raw['normalExit']['signal'] is None;assert not raw['harnessProcessReceipt']['signals']
py=json.loads((payload/'sampler-dependencies.json').read_text())['python'];env=dict(os.environ,PYTHONPATH=str(payload/'private-python'),PYTHONDONTWRITEBYTECODE='1',MPLCONFIGDIR=str(payload/'cache/matplotlib'),NODE_COMPILE_CACHE=str(root/'cache/node'));logs=root/'postprocess';logs.mkdir(exist_ok=False)
commands=[('original-analysis',[py,str(payload/'analyze.py')]),('cpu-scope',[py,str(payload/'cpu_judge.py'),str(payload),'--output-dir',str(payload)]),('coalition',[py,str(payload/'coalition_judge.py'),str(payload)]),('original-exact-cleanup',[py,str(payload/'verify-cleanup.py')]),('original-plot',[py,str(payload/'plot.py')]),('finalize',['/Users/liubu/.hermes/node/bin/node',str(payload/'finalize.mjs')])];results=[]
for name,argv in commands:
 start=time.time()
 with (logs/(name+'.stdout.log')).open('wb')as out,(logs/(name+'.stderr.log')).open('wb')as err:r=subprocess.run(argv,cwd=payload,env=env,stdout=out,stderr=err)
 row={'name':name,'argv':argv,'exitCode':r.returncode,'elapsedSeconds':time.time()-start,'stdout':str((logs/(name+'.stdout.log')).relative_to(root)),'stderr':str((logs/(name+'.stderr.log')).relative_to(root))};results.append(row);(root/'coordinator-postprocess-result.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'formalWholeCaseCredit':0},indent=2)+'\n');print(json.dumps(row),flush=True)
 if r.returncode:print((logs/(name+'.stderr.log')).read_text()[:1800]);sys.exit(r.returncode)
print(json.dumps({'postprocessCompleted':True,'allScriptsExit0':True,'formalCaseCredit':0}))
