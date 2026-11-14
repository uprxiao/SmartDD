from pathlib import Path
import json,hashlib
p=Path(__file__).resolve().parent;repo=Path('/Users/hx/projects/SmartDD');sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
build=json.loads((p/'build.json').read_text())
for bundle in build:
 assert sha(p/(bundle['name']+'.cjs'))==bundle['sha256']
 for s in bundle['sources']:
  if not s.get('stub'):assert sha(Path(s['path']))==s['sha256']
result=json.loads((p/'attempt-ljtlzE/result.json').read_text());assert len(result['checks'])==9 and not result.get('error') and all(x['status']=='passed' for x in result['checks'])
trace=json.loads((p/'attempt-ljtlzE/trace.json').read_text());first=next(x for x in trace if x['id']=='UIE01');assert len(first['calls'])==1 and first['calls'][0]['op']=='open'
close=next(x for x in trace if x['id']=='UIE04');assert [x['op'] for x in close['calls']]==['open','prepareFiles']
voice=next(x for x in trace if x['id']=='UIE07');assert voice['result']=={'ok':True,'phase':'shortcut-sent'}
files={
 'src/renderer/lib/layout/sidebar-tasks.tsx':['task.ptyId','terminals.has'],
 'src/renderer/lib/layout/left-sidebar.tsx':['task.ptyId'],
 'src/renderer/views/project-view.tsx':['task.ptyId'],
 'src/renderer/views/task-archive.tsx':['task.ptyId','resuming.has'],
 'src/renderer/views/resume-advice.tsx':['task.ptyId','rpc.tasks.kill','tasksStore.resume'],
 'src/renderer/features/applications/plugin-actions.tsx':['t.ptyId','tasksStore.terminals.get','insertTerminal'],
 'src/renderer/features/applications/terminal-insertion.tsx':['task.ptyId','sourceKey'],
 'src/renderer/core/auto-resume.ts':['task.ptyId','runtimeSnapshot'],
 'src/renderer/core/tasks-store.ts':['shouldAutoResume','rpc.tasks.open','prepareFileWorkspaceClose'],
 'src/renderer/core/voice-store.ts':['currentTaskId','target.available','rpc.voice.trigger'],
 'src/shared/voice.ts':["['home', 'terminal', 'settings']"],
 'src/main/core/voice/voice-service.ts':["input.origin !== 'terminal'","this.d.ptyAlive","validTarget()"]}
inventory=[]
for name,patterns in files.items():
 f=repo/name;text=f.read_text();assert all(s in text for s in patterns);inventory.append({'path':name,'sha256':sha(f),'observedLines':[{'line':n,'text':s.strip()} for n,s in enumerate(text.splitlines(),1) if any(pattern in s for pattern in patterns)]})
(p/'entry-audit.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2)+'\n')
out={'checksPassed':9,'sourceHashes':'unchanged','entryFilesReviewed':len(inventory),'scope':'Source review plus actual old service with mocks. No UI render or new programmatic entry acceptance.'};(p/'audit-result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps(out,ensure_ascii=False))
