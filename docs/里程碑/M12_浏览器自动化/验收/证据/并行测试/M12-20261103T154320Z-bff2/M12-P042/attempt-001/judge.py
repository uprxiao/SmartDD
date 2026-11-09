from pathlib import Path
import hashlib,json,re,datetime
p=Path(__file__).resolve().parent;raw=json.loads((p/'raw.json').read_text());checks=[]
def check(name,fn):
 try:fn();checks.append({'id':name,'status':'passed'})
 except Exception as e:checks.append({'id':name,'status':'failed','error':str(e)})
def yes(value,detail='predicate false'):
 assert value,detail
for f in raw['files']:yes(hashlib.sha256((p/f['path']).read_bytes()).hexdigest()==f['sha256'],f['path'])
m=json.loads((p/'inputs/manifest.json').read_text());commands=json.loads((p/'inputs/browser-commands.generated.json').read_text());caps=m['capabilities'];byid={c['id']:c for c in caps};source={c['id']:c for c in commands}
check('unique-complete-82',lambda:yes(len(caps)==len(byid)==len(commands)==len(source)==82 and set(byid)==set(source)))
check('exact-read21-write61-no-external',lambda:yes(sum(c['semantics']=='read' for c in caps)==21 and sum(c['semantics']=='write' for c in caps)==61 and {c['semantics'] for c in caps}=={'read','write'}))
def policies():
 for c in caps:
  r=source[c['id']];yes(c['binding']['cli']['command']==r['command'] and c['semantics']==r['semantics'],c['id']);yes(c['permission']=='browser.'+c['semantics'],c['id'])
  if c['semantics']=='read':yes(c['retry']=='safe-read' and 'protection' not in c,c['id'])
  else:yes(c['retry']=='never' and c['protection']=={'kind':'operation-receipt','object':'browser_operation','key':'requestId'},c['id'])
check('all82-authority-retry-and-write-receipt',policies)
def special():
 c={tuple(c['binding']['cli']['command']):c for c in caps}
 for name in [('browser','operation','get'),('browser','wait')]:yes(c[name]['semantics']=='read',str(name))
 for name in [('browser','wait','fn'),('browser','access','request')]:yes(c[name]['semantics']=='write',str(name))
 wait=c[('browser','wait')];schema=json.loads((p/'inputs'/wait['inputSchemaPath']).read_text());yes('fn' not in schema['properties'] and schema['additionalProperties'] is False)
check('operation-get-read-and-scripted-wait-separated',special)
def mapping():
 rows=[]
 for line in (p/'inputs/mapping.generated.md').read_text().splitlines():
  if not re.match(r'^\| \d+ \|',line):continue
  cols=re.split(r'(?<!\\)\|',line)[1:-1];cols=[c.strip().replace('\\|','|') for c in cols];yes(len(cols)==10)
  if cols[8]=='不适用':continue
  usage=cols[4].strip('`');rows.append((usage,'read' if cols[6]=='读' else 'write'))
 yes(len(rows)==82 and len(dict(rows))==82);yes(dict(rows)=={c['usage']:c['semantics'] for c in commands},'generated mapping differs')
check('complete-generated-mapping-agreement',mapping)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'case':'M12-T093','layer':'U','checks':checks,'status':'passed' if all(c['status']=='passed' for c in checks) else 'failed','basis':'Frozen raw inputs, separate static assertions, no reliance on process exit or native parser claim'};(p/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':result['status'],'checks':checks},ensure_ascii=False))
