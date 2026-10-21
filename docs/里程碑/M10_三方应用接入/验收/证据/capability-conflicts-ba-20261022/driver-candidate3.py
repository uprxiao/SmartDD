from pathlib import Path
import json,hashlib,datetime
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4');e=Path('/private/tmp/m10-capability-conflicts-ba-20261022');u=e/'recheck-work';v=e/'final-work';assert not v.exists();v.mkdir();old=json.loads((e/'final-inputs.json').read_text());allowed={f['path']:f['sha256'] for f in json.loads((e/'recheck-source.json').read_text())['files']}
for f in old['files']:
 raw=(u/f['path']).read_bytes();assert hashlib.sha256(raw).hexdigest()==allowed.get(f['path'],f['sha256']);p=v/f['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
for p in ['node_modules','out']:(v/p).symlink_to(w/p,target_is_directory=True)
p=v/'src/main/core/applications/task-capability-launcher.ts';s=p.read_text();oldline='entry.runtime=runtime;runtime.snapshot.sessionCapabilities=current.pointer;';assert s.count(oldline)==1;s=s.replace(oldline,oldline+"\n      if(!unavailable&&facets&&(facets.applications.size||facets.standardSkills.size||facets.projectMcp))runtime.snapshot.selfCheck={status:'failed',issues:[...new Set([...runtime.snapshot.selfCheck.issues,'AGENT_CAPABILITY_NAME_CONFLICT'])],at:Date.now()};");p.write_text(s)
p=v/'src/main/core/applications/__tests__/task-capability-launcher.test.ts';s=p.read_text()
for tail in ["expect(readFileSync(file,'utf8')).toBe(text);expect(capabilities.enabled","expect(readFileSync(file,'utf8')).toBe(text);expect(fixed.snapshot.standardSkills","expect(readFileSync(file,'utf8')).toBe(text);if(mode==='resume')"]:
 assert s.count(tail)==1,tail;s=s.replace(tail,"expect(runtime.selfCheck).toMatchObject({status:'failed',issues:['AGENT_CAPABILITY_NAME_CONFLICT']});"+tail)
p.write_text(s)
rows=[];deltas=[]
for f in old['files']:
 raw=(v/f['path']).read_bytes();h=hashlib.sha256(raw).hexdigest();rows.append({'path':f['path'],'bytes':len(raw),'sha256':h})
 if h!=f['sha256']:deltas.append(f['path'])
assert len(deltas)==2 and all('task-capability-launcher' in p for p in deltas),deltas
(e/'candidate3-inputs.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':rows},ensure_ascii=False,indent=2)+'\n');(e/'candidate3-changes.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'copy':str(v),'changedSinceInitialFinal':deltas,'productionChange':'one display-only selfCheck line preserves known NAME_CONFLICT without withdrawing unrelated capabilities','testChange':'optional fourth arg on two existing instances;three assertions across10 public facet cases require visible conflict status','immutableOther2008Inputs':True,'fullMainRecheckPending':True,'originalAndRecheckJobsStillFrozenAndRunning':True},indent=2)+'\n');print('candidate3 frozen',len(rows),'inputs, 2 changes, no existing running sources edited')
