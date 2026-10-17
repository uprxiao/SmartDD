#!/usr/bin/env python3
import argparse,hashlib,importlib.util,json,pathlib,subprocess,time,zipfile,copy
HERE=pathlib.Path(__file__).resolve()
def load(n):
 s=importlib.util.spec_from_file_location(n,HERE.with_name(n+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
base=load('predev-office-probe');adapter=load('predev-office-adapter')
sha=lambda b:hashlib.sha256(b).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--poi-root',default='/tmp/predev-office-poi');a=p.parse_args();root=pathlib.Path(a.root).resolve();poi=pathlib.Path(a.poi_root).resolve()
subprocess.run(['python3',str(HERE.with_name('predev-office-probe.py')),'--prepare',str(root)],check=True)
report={'scope':'Office predevelopment candidate proof, not App acceptance','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cases':[],'subprocesses':[],'sources':{x.name:sha(x.read_bytes()) for x in HERE.parent.glob('predev-office-*.py')}}
def case(cid,title,fn):
 try:f=fn();report['cases'].append({'id':cid,'title':title,'status':'passed','facts':f})
 except Exception as e:report['cases'].append({'id':cid,'title':title,'status':'failed','error':repr(e)})
 print(cid,report['cases'][-1]['status'],flush=True)
def java(name,op,path,out=None):
 args=['java','-Xmx512m','-Dlog4j2.statusLoggerLevel=OFF','-cp',str(poi/'classes')+':'+str(poi/'lib/*'),'PoiProbe',op,str(path)]+([str(out)] if out else [])
 t=time.monotonic();r=subprocess.run(args,capture_output=True,text=True,timeout=30);elapsed=round((time.monotonic()-t)*1000,2)
 (root/(name+'.stdout')).write_text(r.stdout);(root/(name+'.stderr')).write_text(r.stderr);report['subprocesses'].append({'name':name,'args':args,'exitCode':r.returncode,'durationMs':elapsed})
 assert r.returncode==0,r.stderr;return json.loads(next(l for l in reversed(r.stdout.splitlines()) if l.startswith('{')))
def expect(d,expected):
 cells={x['cell']:x for x in d['cells'] if x['sheet']=='Calc'}
 for cell,want in expected.items():
  got=cells[cell];assert got['type']!='EXCEPTION',got
  if isinstance(want,str):assert got['type']=='ERROR' and got['value']==want,got
  else:assert got['type']=='NUMERIC' and float(got['value'])==want,got
 return {'verifiedCells':len(expected),'cells':cells}
def oa12():
 target=root/'oa12-poi-candidate.xlsx';first=java('oa12-recalc','read',root/'oa12-deleted.xlsx',target);expect(first,{'B2':'#REF!','B3':'#REF!','B4':100})
 again=java('oa12-reopen','read',target);return {'first':expect(first,{'B2':'#REF!','B3':'#REF!','B4':100}),'reopen':expect(again,{'B2':'#REF!','B3':'#REF!','B4':100}),'originalAdapterUnchanged':True}
case('OP03','Original OA12 failing workbook: independent POI calculation + saved candidate reopened',oa12)
original=base.read(root/'rich-source.xlsx');originalhash=sha((root/'rich-source.xlsx').read_bytes());normalized,expanded=adapter.shared_expand(original);base.write(root/'rich-normalized.xlsx',normalized)
expected={'B2':7,'B3':7,'B4':100,'B5':3,'B6':42,'B7':7,'B8':7,'B9':7,'B10':5,'B11':6,'B12':8,'B15':7,'B16':3,'D2':9,'D3':12}
def normal():return {'calculation':expect(java('rich-normalized','read',root/'rich-normalized.xlsx'),expected),'expandedShared':expanded,'note':'POI raw shared cross-sheet parsing is not used'}
case('OP04','Direct/range/named/structured/3D/shared/array/IFERROR/INDIRECT real workbook',normal)
for op,new in [('rename',"计划 O'Brien"),('delete',None)]:
 def check(op=op,new=new):
  candidate,details=adapter.mutate(original,'Data',new);path=root/('rich-'+op+'-patched.xlsx');base.write(path,candidate)
  calcpath=root/('rich-'+op+'-engine.xlsx');calc=java('rich-'+op+'-calc','read',path,calcpath)
  wants=dict(expected)
  if op=='rename':wants['B16']=66
  else:wants.update({'B2':'#REF!','B3':'#REF!','B5':77,'B7':88,'B8':'#REF!','B9':'#REF!','B11':'#REF!','B12':'#REF!','B15':99,'B16':66,'D2':'#REF!','D3':'#REF!'})
  verified=expect(calc,wants)
  merged,extracted=adapter.transplant_values(candidate,base.read(calcpath));output=root/('rich-'+op+'-final.xlsx');base.write(output,merged)
  changed=base.old.changed_parts(original,merged);guard=base.guard(original,merged,changed,removed=set(details['removedParts']))
  # Validate allowed dependency closure, not merely every observed change.
  allowed={base.old.W,base.old.WR,'[Content_Types].xml','xl/worksheets/sheet2.xml','xl/charts/chart1.xml'}
  assert changed<=allowed,changed
  reread=expect(java('rich-'+op+'-final-reopen','read',output),wants)
  assert merged['xl/styles.xml']==original['xl/styles.xml'] and merged['xl/theme/theme1.xml']==original['xl/theme/theme1.xml']
  assert base.old.OPAQUE_NAME in merged and merged[base.old.OPAQUE_NAME]==original[base.old.OPAQUE_NAME]
  if op=='rename':
   f=base.tree(merged['xl/worksheets/sheet2.xml']);b9=next(c for c in f.findall('.//{%s}c'%base.S) if c.get('r')=='B9');assert b9.findtext('{%s}f'%base.S)=='SUM(Sales[Value])'
  return {'calculation':verified,'reopen':reread,'adapter':details,'cacheExtraction':extracted,'packageGuard':guard,'wholeEnginePackageNotInstalled':True}
 case('OP05' if op=='rename' else 'OP06','Precise '+op+' with dependency evaluation, value-only extraction and reopen',check)
def ppt():
 d=java('ppt-read','pptx',root/'rich-edited.pptx');assert d['slides']==2 and d['masters']>=1;assert 'TABLE_EDITED' in d['tables'] and 'UNCHANGED_CELL' in d['tables'];assert len(d['charts'])==1 and d['charts'][0]['embeddedB2']==9
 return d
case('OP07','Independent XSLF reads real table/chart embedded data and master',ppt)
def guardnegative():
 after=dict(original);del after[base.old.OPAQUE_NAME]
 try:base.guard(original,after,set())
 except ValueError:return {'rejected':True,'reason':'undeclared unknown part loss'}
 raise AssertionError('loss accepted')
case('OP08','Package gate rejects undeclared unknown part loss',guardnegative)
assert sha((root/'rich-source.xlsx').read_bytes())==originalhash
report['originalUnchanged']=True;report['summary']={'passed':sum(c['status']=='passed' for c in report['cases']),'failed':sum(c['status']=='failed' for c in report['cases'])};report['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
(root/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']));raise SystemExit(bool(report['summary']['failed']))
