from pathlib import Path
w=Path('/private/tmp/m10-legacy-recovery-r-20261021/work-r4')
p=w/'src/main/core/applications/__tests__/task-capability-launcher.test.ts';s=p.read_text();assert s.count("'application-package:'+fixed.snapshot.packages.find(p=>p.appId==='mail')!.packageHash")==1;s=s.replace("'application-package:'+fixed.snapshot.packages.find(p=>p.appId==='mail')!.packageHash","'app:'+fixed.snapshot.packages.find(p=>p.appId==='mail')!.packageHash")
old="expect(protectedIds.map(r=>r.resource_id)).not.toContain(zen.resourceId);"
assert s.count(old)==1;s=s.replace(old,old+"for(const ref of refs as {ref_id:string;ref_kind:string}[])if(ref.ref_kind==='legacy-runtime')expect(protectedIds.map(r=>r.resource_id)).toContain(ref.ref_id);")
p.write_text(s)
p=w/'src/main/core/applications/session-registry.ts';s=p.read_text();old="    for(const id of projectionIds){const ref=all.find(r=>r.refId===id);"
assert s.count(old)==1;s=s.replace(old,"    // The ordinary launcher always reads its original M4 runtime, including\n    // when its context MCP is disabled. Narrow only application-specific roots.\n    for(const ref of all.filter(r=>r.refKind==='legacy-runtime'))if(!roots.some(r=>r.refId===ref.refId))roots.push(ref);\n"+old);p.write_text(s)
p=w/'src/main/core/applications/session-diagnostics.ts';s=p.read_text();old=" private resourceIssue(session:StoredCapabilitySession):string|null{\n  const refs=this.store.sqlite.prepare('SELECT ref_id FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(session.snapshot.taskId) as {ref_id:string}[];\n  try{const projectionRoots:string[]=[];"
new=""" private resourceIssue(session:StoredCapabilitySession,appId?:string):string|null{
  let refs=this.store.sqlite.prepare('SELECT ref_id FROM capability_session_refs WHERE task_id=? ORDER BY ref_id').all(session.snapshot.taskId) as {ref_id:string}[];
  const scoped=appId!==undefined&&session.snapshot.runner==='codex'&&!session.snapshot.legacyBinding;
  const skills=[...session.snapshot.packages.filter(p=>!scoped||p.appId===appId).flatMap(p=>p.skills),...session.snapshot.standardSkills];
  try{
   if(scoped){
    const projectionIds=refs.filter(ref=>{const resource=this.store.get(ref.ref_id);if(!['session-projection','agent-projection'].includes(resource.kind))return false;const root=this.store.directory(resource);return skills.some(skill=>{const suffix=relative(root,skill.projectionPath);return !!suffix&&!suffix.startsWith('..')&&!isAbsolute(suffix);});}).map(r=>r.ref_id);
    refs=this.sessions.scopedReferencesCoordinated(session.snapshot.taskId,[appId!],projectionIds).map(r=>({ref_id:r.refId}));
   }
   const projectionRoots:string[]=[];"""
assert s.count(old)==1;s=s.replace(old,new)
old="for(const skill of [...session.snapshot.packages.flatMap(p=>p.skills),...session.snapshot.standardSkills])"
assert s.count(old)==1;s=s.replace(old,"for(const skill of skills)")
old="   applications.push({appId,name:"
assert s.count(old)==1;s=s.replace(old,"   const appResourceIssue=session&&fixed?this.resourceIssue(session,appId):null;if(appResourceIssue)issues.push(appResourceIssue);\n"+old)
old="resourceState:fixed?(resourceIssue?'unavailable':'verified'):'unverified',issueCode:resourceIssue??"
assert s.count(old)==1;s=s.replace(old,"resourceState:fixed?(appResourceIssue?'unavailable':'verified'):'unverified',issueCode:appResourceIssue??")
p.write_text(s)
