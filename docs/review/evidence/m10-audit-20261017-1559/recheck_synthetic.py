import importlib.util,sys,json,hashlib,contextlib,io
from pathlib import Path
sys.dont_write_bytecode=True
root=Path.cwd();out=Path(__file__).resolve().parent
names={'mail':'foxmail/synthetic_mail_probe.py','providers':'provider-contract/provider_contract_probe.py','broker':'local-broker/local_broker_probe.py'}
selected=sys.argv[1:] or ['mail','providers']
result=[]
for name in selected:
 source=root/'docs/里程碑/M10_三方应用接入/技研/实验'/names[name]
 dest=out/name;dest.mkdir(parents=True,exist_ok=True)
 spec=importlib.util.spec_from_file_location('m10_audit_'+name,source);m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
 m.ROOT=dest
 log=io.StringIO()
 try:
  with contextlib.redirect_stdout(log):m.main()
  result.append({'name':name,'status':'completed','source':str(source.relative_to(root)),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'stdout':log.getvalue().strip()})
 except Exception as e:
  result.append({'name':name,'status':'failed','errorType':type(e).__name__,'source':str(source.relative_to(root))})
(out/('recheck-'+('-'.join(selected))+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
if any(r['status']!='completed' for r in result):sys.exit(1)
