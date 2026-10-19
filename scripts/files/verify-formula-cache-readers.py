"""Independent openpyxl(data_only) and formula readbacks of source/LO copies."""
from pathlib import Path
import json,hashlib,sys,platform,importlib.metadata
result_path=Path(sys.argv[1]);deps=Path(sys.argv[2]);assert str(deps).startswith('/private/tmp/willyou-');sys.path.insert(0,str(deps))
import openpyxl
assert openpyxl.__version__=='3.1.5'
r=json.loads(result_path.read_text());assert r['status']=='passed';rows=[]
def fingerprint(p):
 s=p.stat();return {'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'inode':s.st_ino,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
for c in r['checks']:
 for kind,path in [('source',Path(r['projectPath'])/c['name']),('LibreOffice-recalculated-copy',Path(r['scratch'])/('recalc-'+c['name'])/c['name'])]:
  before=fingerprint(path);cache=openpyxl.load_workbook(path,data_only=True,read_only=True);formulas=openpyxl.load_workbook(path,data_only=False,read_only=True);s=cache['Data'];f=formulas['Data'];values={k:s[k].value for k in ['A1','B1','C1','D1','A3','D3']};assert values['A1']==21 and values['D1']==107 and values['A3']=='UNCHANGED 中文🙂'and values['D3']==0
  formula=f['B1'].value;expected='=A1*2'if c['mode']=='supported'else'=WILLYOUNOTIMPLEMENTED(A1)';assert (formula==expected if kind=='source'else formula.upper()==expected.upper())and f['C1'].value=='=B1+3'
  if c['mode']=='supported':assert values['B1']==42 and values['C1']==45
  elif kind=='source':assert values['B1']is None and values['C1']is None
  else:assert values['B1']==values['C1']=='#NAME?'
  cache.close();formulas.close();assert fingerprint(path)==before;rows.append({'name':c['name'],'readerMode':kind,'values':values,'formulaB1':formula,'fingerprint':before,'readOnly':True,'pass':True})
sources={str(p.relative_to(deps)):hashlib.sha256(p.read_bytes()).hexdigest()for p in deps.rglob('*')if p.is_file()and p.suffix in ['.py','.txt']and'__pycache__'not in str(p)}
print(json.dumps({'atSource':str(result_path),'python':platform.python_version(),'openpyxl':openpyxl.__version__,'et_xmlfile':importlib.metadata.version('et_xmlfile'),'dependencyRoot':str(deps),'dependencySourceHashes':sources,'checks':rows,'status':'passed','boundary':'Actual fixed openpyxl3.1.5 data_only and formula readers, plus separate packaged LibreOffice-recalculated copies. Dependencies only temporary test directory, not product requirements. All eight files read-only, hashes and inode/time fingerprints unchanged.'},ensure_ascii=False,indent=2))
