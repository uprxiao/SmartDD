"""Verify archived native events, host chronology, random files and cleanup."""
from pathlib import Path
import gzip,hashlib,json
base=Path(__file__).resolve().parent;results=base/'results';checks=[]
def test(name,fn):
 try:fn();checks.append({'id':name,'status':'passed'})
 except Exception as e:checks.append({'id':name,'status':'failed','error':str(e)})
def require(value,message):
 if not value:raise AssertionError(message)
def read(name):return json.loads((results/name).read_text())
def lines(name):
 p=results/name;return [json.loads(l) for l in (gzip.decompress(p.read_bytes()).decode() if name.endswith('.gz') else p.read_text()).splitlines()]
for row in read('recordings-manifest.json'):
 test('archive hash:'+row['file'],lambda r=row:require(hashlib.sha256((results/r['file']).read_bytes()).hexdigest()==r['sha256'],'archive differs'))
writers=read('writers-result.json')['results'];events=lines('writers-native.jsonl.gz');host=lines('writers-host.jsonl')
require(len(writers)==2,'both combinations required')
for case in writers:
 id=case['id'];hs=[e for e in host if e.get('case')==id]
 def verify_case():
  require(case['status']=='passed','live run failed');require(all(case['checks'].values()),'live assertion failed')
  by=lambda name:next(e for e in hs if e['event']==name)
  require(by('dispatch-blocked')['childStarted']==False,'child already started before release')
  require(by('delegate-queued')['seq']<by('writer-slot-released')['seq']<by('child-dispatched')['seq'],'release order wrong')
  exits=[e for e in hs if e['event']=='owner-exited'];require(len(exits)==3,'three owned invocations required')
  for e in exits:
   for x in e['processExit'] if isinstance(e['processExit'],list) else [e['processExit']]:require(x=={'code':0,'signal':None},'owner did not exit cleanly')
  for suffix in ['parent-initial','child-child','parent-resume']:
   es=[e for e in events if e['actor']==id+'-'+suffix];pending=set()
   for e in es:
    if e['driver']=='codex':
     item=e.get('params',{}).get('item',{})
     if item.get('type') in ['commandExecution','mcpToolCall']:
      if e.get('method')=='item/started':pending.add(item['id'])
      if e.get('method')=='item/completed':pending.discard(item['id'])
    elif e.get('type') in ['assistant','user']:
     blocks=e.get('message',{}).get('content',[])
     if not isinstance(blocks,list):continue
     for b in blocks:
      if b['type']=='tool_use':pending.add(b['id'])
      elif b['type']=='tool_result':pending.discard(b['tool_use_id'])
   require(not pending,'pending native tools at owner exit')
  initial='\n'.join(json.dumps(e) for e in events if e['actor']==id+'-parent-initial')
  child='\n'.join(json.dumps(e) for e in events if e['actor']==id+'-child-child')
  resumed='\n'.join(json.dumps(e) for e in events if e['actor']==id+'-parent-resume')
  require(all(x in initial for x in ['parent-before.txt','parent-after.txt','wy_delegate']),'parent native writes missing')
  require('child.txt' in child and ('commandExecution' in child or 'Bash' in child),'child native writer missing')
  require('wy_observe' in resumed and 'child.txt' in resumed and 'parent-observed.txt' in resumed,'parent did not observe/read native file')
  require(case['files']['child']==case['files']['parentObserved'] and case['files']['child'] in resumed,'resumed parent random file mismatch')
 test('real writable pair:'+id,verify_case)
for case in read('steer-result.json')['results']:
 def verify_steer():
  require(case['status']=='passed','real steer failed');hs=[e for e in lines('steer-host.jsonl') if e.get('driver')==case['driver']]
  held=next(e for e in hs if e['event']=='native-tool-held');submit=next(e for e in hs if e['event']=='mid-turn-input-submitted');require(held['seq']<submit['seq'],'not mid-tool input')
  native=[e for e in lines('steer-native.jsonl.gz') if e.get('driver')==case['driver']]
  terminals=[e for e in native if e.get('method')=='turn/completed' or e.get('type')=='result']
  require(len(terminals)==1,'unexpected queue/new terminal');require(terminals[0]['t']>submit['t'],'input sent after completion')
  require(case['marker'] in case['final'],'new instruction not consumed')
  if case['driver']=='codex':require(case['accepted']['turnId']==case['turnId'] and case['sameTurnCompleted'],'steer turn mismatch')
  else:require(case['marker'] in terminals[0].get('result',''),'SDK consumed stream but model did not act on input')
  require(any(e['event']=='owner-exited' and e['code']==0 and e['signal']==None for e in hs),'native process not cleanly exited')
 test('real midturn input:'+case['driver'],verify_steer)
test('owned process and server cleanup',lambda:require(read('writers-cleanup.json')=={'remainingOwned':[],'httpClosed':True} and read('steer-cleanup.json')['httpClosed'],'resources left'))
repo=next(p for p in base.parents if (p/'src/main/db/schema.ts').exists())
for row in json.loads((base/'before.json').read_text()):
 test('preserved original:'+Path(row['snapshot']).name,lambda r=row:require(hashlib.sha256((repo/r['snapshot']).read_bytes()).hexdigest()==r['sha256'],'original bytes differ'))
first=base.parent/'20261116_复核修订验证'
for row in json.loads((first/'source-baseline.json').read_text())['smartdd']:
 test('production unchanged:'+row['path'],lambda r=row:require(hashlib.sha256((repo/r['path']).read_bytes()).hexdigest()==r['sha256'],'production source changed'))
report='docs/里程碑/M14_统一Agent工作区/技研/复核_20261116/复核报告.md'
originalSha=next(r['sha256'] for r in json.loads((first/'delivery-manifest.json').read_text())['files'] if r['path']==report)
current=(repo/report).read_text()
def section(s):return s.split('## 7. 用户已确认的决定（2026-11-16）\n',1)[1].split('\n## 8.',1)[0]
test('entire report including confirmed section 7 unchanged',lambda:require(hashlib.sha256((repo/report).read_bytes()).hexdigest()==originalSha,'report differs from first delivery freeze'))
result={'scope':'offline audit of this round real native recordings; no product App','confirmedSectionSha256':hashlib.sha256(section(current).encode()).hexdigest(),'tests':checks,'failed':sum(c['status']=='failed' for c in checks)}
(results/'evidence-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(bool(result['failed']))
