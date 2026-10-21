from pathlib import Path
import sys,json,hashlib,difflib
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-claude-delivery-aw-20261022');sha=lambda b:hashlib.sha256(b).hexdigest();result=json.loads((e/'regression-result.json').read_text());assert result['sourceFrozen'] and result['exitCode']==0
prod='src/main/core/applications/agent-adapter-registry.ts';test='src/main/core/applications/__tests__/task-capability-launcher.test.ts';original={x['path']:x for x in json.loads((e/'source-before-proof.json').read_text())['files']}
if sys.argv[1]=='test':
 for p in [prod,test]:assert sha((w/p).read_bytes())==original[p]['sha256'],p
 p=w/test;old=p.read_text();marker=" it('refuses a last-fork Claude delivery proof change without forking or changing the original S',async()=>{"
 assert old.count(marker)==1;p.write_text(old.replace(marker,(e/'proof-test-snippet.txt').read_text()+marker))
 (e/'proof-red-source.json').write_text(json.dumps({'production':{'path':prod,'sha256':sha((w/prod).read_bytes())},'newTest':{'path':test,'sha256':sha(p.read_bytes())}},indent=2)+'\n')
 (e/'proof-test.diff').write_text(''.join(difflib.unified_diff(old.splitlines(True),p.read_text().splitlines(True),fromfile='before/'+test,tofile='after/'+test)))
elif sys.argv[1]=='fix':
 report=json.loads((e/'proof-red-report.json').read_text());failed=[a for t in report['testResults'] for a in t['assertionResults'] if a['status']=='failed'];assert len(failed)==1 and 'requires the actual canonical plugin root and hash' in failed[0]['fullName'] and report['numPassedTests']==0
 p=w/prod;assert sha(p.read_bytes())==original[prod]['sha256'];old=p.read_text();line="    if(input.claudeDelivery&&snapshot.runner!=='claude-code')throw new ApplicationError('INVALID_INPUT','原目录交付依据只适用于Claude');"
 assert old.count(line)==1;new=line+"\n    if(input.claudeDelivery&&(!input.pluginRoot||!input.pluginHash||input.claudeDelivery.taskId!==snapshot.taskId))throw new ApplicationError('SNAPSHOT_IMMUTABLE','Claude原目录交付必须包含原任务的实际插件路径及hash');"
 p.write_text(old.replace(line,new));(e/'proof-host.diff').write_text(''.join(difflib.unified_diff(old.splitlines(True),p.read_text().splitlines(True),fromfile='before/'+prod,tofile='after/'+prod)))
else:raise Exception('mode')
print('applied',sys.argv[1],'only after original full regression terminal')
