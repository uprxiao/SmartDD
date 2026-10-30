#!/usr/bin/env python3
"""Deterministic adversarial names/values: full real formula engine, not parser-only tests."""
import argparse,importlib.util,pathlib,json,subprocess,hashlib,time
HERE=pathlib.Path(__file__).resolve()
def load(n):
 s=importlib.util.spec_from_file_location(n,HERE.with_name(n+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
b=load('predev-office-probe');a=load('predev-office-adapter');p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--poi-root',default='/tmp/predev-office-poi');v=p.parse_args();root=pathlib.Path(v.root).resolve();out=root/'variations';out.mkdir(exist_ok=True);original=b.read(root/'rich-source.xlsx');cases=[]
for i,(old,new,x,y) in enumerate([('Data','新表',-3,4),("O'Brien","另一个 O'Brien",0,0),('计划 表','Budget 2027',0.5,1.25),('汇总_1','Sheet_42',12345,-333),('Data','Σ',-0.5,-1.5),('计划 表','名称中含😀',1,100000),("A'B'C",'D E',2,5),('Data','Αβγ',17,19)]):
 source=original if old=='Data' else a.mutate(original,'Data',old)[0]
 source=dict(source);doc=b.tree(source['xl/worksheets/sheet1.xml']);cells={c.get('r'):c for c in doc.findall('.//{%s}c'%b.S)}
 for addr,n in [('B2',x),('B3',y)]:cells[addr].find('{%s}v'%b.S).text=str(n)
 source['xl/worksheets/sheet1.xml']=b.xml(doc)
 for op,target in [('rename',new),('delete',None)]:
  t=time.monotonic()
  try:
   candidate,details=a.mutate(source,old,target);path=out/f'case-{i}-{op}.xlsx';b.write(path,candidate)
   args=['java','-Xmx512m','-Dlog4j2.statusLoggerLevel=OFF','-cp',v.poi_root+'/classes:'+v.poi_root+'/lib/*','PoiProbe','read',str(path)]
   r=subprocess.run(args,capture_output=True,text=True,timeout=30);assert r.returncode==0,r.stderr;data=json.loads(next(l for l in reversed(r.stdout.splitlines()) if l.startswith('{')));actual={c['cell']:c for c in data['cells'] if c['sheet']=='Calc'}
   expected={'B2':x+y,'B3':x+y,'B4':100,'B5':x,'B6':42,'B7':x+y,'B8':x+y,'B9':x+y,'B10':5,'B11':x*2,'B12':y*2,'B15':x+y,'B16':66,'D2':x*3,'D3':y*3}
   if op=='delete':expected.update({'B2':'#REF!','B3':'#REF!','B5':77,'B7':88,'B8':'#REF!','B9':'#REF!','B11':'#REF!','B12':'#REF!','B15':99,'D2':'#REF!','D3':'#REF!'})
   for cell,want in expected.items():
    got=actual[cell];assert got['type']!='EXCEPTION',got
    if isinstance(want,str):assert got['type']=='ERROR' and got['value']==want,got
    else:assert got['type']=='NUMERIC' and float(got['value'])==want,(cell,want,got)
   assert candidate[b.old.base.old.OPAQUE_NAME]==source[b.old.base.old.OPAQUE_NAME];status='passed';facts={'expected':expected,'actual':actual,'partChanges':sorted(b.old.changed_parts(source,candidate))}
  except Exception as e:status='failed';facts={'error':repr(e)}
  cases.append({'sample':i,'operation':op,'old':old,'new':new,'values':[x,y],'status':status,'durationMs':round((time.monotonic()-t)*1000,2),'facts':facts})
report={'scope':'8 declared varied names/value samples × 2 real engine operations; not a compatibility corpus','sourceSha256':hashlib.sha256(HERE.read_bytes()).hexdigest(),'cases':cases,'summary':{'passed':sum(c['status']=='passed' for c in cases),'failed':sum(c['status']=='failed' for c in cases)}}
(out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report['summary']));raise SystemExit(bool(report['summary']['failed']))
