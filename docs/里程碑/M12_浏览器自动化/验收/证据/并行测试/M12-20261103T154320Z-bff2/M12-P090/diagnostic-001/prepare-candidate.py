from pathlib import Path
import json,hashlib,difflib,datetime
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD');root=Path('/private/tmp/willyou-m12-p089-coalition-long-001/analysis-prior-004');c=root/'candidate';c.mkdir(exist_ok=True)
p=repo/'src/main/core/applications/tool-service.ts';base=p.read_text();s=base
needle='  private readonly validator = new AjvJsonSchemaValidator();';assert s.count(needle)==1
s=s.replace(needle,needle+"\n  private readonly contracts = new Map<string,ReturnType<AjvJsonSchemaValidator['getValidator']>>();")
needle='  private clock(): number { return this.options.now?.() ?? Date.now(); }'
method="""  private contractValidator(selected: SelectedTool,kind: 'input' | 'output') {
    // The package hash fixes these schemas. Fresh parsed objects otherwise make
    // Ajv retain a new compiled environment for every call. Authorization and
    // package integrity are still checked before this compiler lookup.
    const key = canonicalJson([this.entry,selected.application.packageHash,selected.declaration.name,selected.declaration.contractMajor,kind]);
    let validate = this.contracts.get(key);
    if (!validate) {
      validate = this.validator.getValidator((kind === 'input' ? selected.tool.inputSchema : selected.tool.outputSchema) as JsonSchemaType);
      this.contracts.set(key,validate);
    }
    return validate;
  }
"""
assert s.count(needle)==1;s=s.replace(needle,method+needle)
a='this.validator.getValidator(selected.tool.inputSchema as JsonSchemaType)(call.arguments)';assert s.count(a)==1;s=s.replace(a,"this.contractValidator(selected,'input')(call.arguments)")
a='const outputValidator = this.validator.getValidator(selected.tool.outputSchema as JsonSchemaType), canRetry';assert s.count(a)==1;s=s.replace(a,"const outputValidator = this.contractValidator(selected,'output'), canRetry")
(c/'tool-service.ts').write_text(s);(c/'tool-service.patch').write_text(''.join(difflib.unified_diff(base.splitlines(True),s.splitlines(True),fromfile='a/src/main/core/applications/tool-service.ts',tofile='b/src/main/core/applications/tool-service.ts')))
p=repo/'src/main/core/applications/__tests__/tool-service.test.ts';testbase=p.read_text();t=testbase
needle="import { randomUUID } from 'node:crypto';";t=t.replace(needle,needle+"\nimport { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';\nimport { applicationMcpServerName, applicationNativeSkillName } from '@shared/application-session';\nimport { applicationSkillContentHash } from '../session-registry';")
needle="  it('lists actual fixed package schemas and routes using host project/task/package context', async () => {"
tests=r'''  it('reuses immutable schema compilers while validating every new request and current authority', async () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype,'getValidator');
    try {
      for (let i = 0; i < 8; i++) expect(await service.call(run.runId,randomUUID(),call('body-' + i))).toMatchObject({status:'ok',value:{value:'body-' + i}});
      expect(compile).toHaveBeenCalledTimes(2);
      expect(count).toBe(8);
      expect(await service.call(run.runId,randomUUID(),{...call(),arguments:{unexpected:true}})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
      expect(count).toBe(8);
      const original = execute; execute = async (...args) => ({...await original(...args) as Record<string,unknown>,value:123});
      expect(await service.call(run.runId,randomUUID(),call('fresh-invalid-output'))).toMatchObject({status:'error',error:{code:'INVALID_RESPONSE'}});
      expect(count).toBe(9);
      connectionAllowed = false;
      expect(await service.call(run.runId,randomUUID(),call('revoked'))).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
      connectionAllowed = true;
      const file = join(f.store.root,f.application!.relativePath,'adapter/index.cjs'), bytes = readFileSync(file);
      try {
        writeFileSync(file,'damaged after compiler warmup');
        expect(await service.call(run.runId,randomUUID(),call('damaged'))).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});
      } finally { writeFileSync(file,bytes); }
      expect(count).toBe(9);
      expect(compile).toHaveBeenCalledTimes(2);
    } finally { compile.mockRestore(); }
  });
  it('keeps compiled constraints separate for two pinned versions of the same capability', async () => {
    const compile = vi.spyOn(AjvJsonSchemaValidator.prototype,'getValidator');
    let second: Awaited<ReturnType<typeof f.create>> | undefined;
    try {
      expect(await service.call(run.runId,randomUUID(),call('long-original'))).toMatchObject({status:'ok'});
      const source = {manifest:structuredClone(f.applicationSource!.manifest),files:{...f.applicationSource!.files}};
      source.manifest.version = '2.0.0';
      const input = JSON.parse(source.files['schemas/input.json'].toString('utf8')); input.properties.value.maxLength = 3;
      source.files['schemas/input.json'] = Buffer.from(JSON.stringify(input));
      source.manifest.files = Object.entries(source.files).map(([path,bytes]) => ({path,size:bytes.length,sha256:digest(bytes),executable:false}));
      const next = await f.packageRegistry.install(source); await f.packageRegistry.activate(next.packageHash,1);
      const snapshot = structuredClone(f.snapshot); snapshot.taskId = randomUUID();
      const selected = snapshot.packages[0]; selected.packageHash = next.packageHash; selected.version = next.version;
      for (const skill of selected.skills) {
        const declaration = source.manifest.skills.find(s => s.id === skill.skillId)!;
        skill.nativeName = applicationNativeSkillName(selected.appId,skill.skillId,next.packageHash);
        skill.contentHash = applicationSkillContentHash(source.manifest,declaration.path);
        skill.projectionPath = join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills',skill.nativeName,'SKILL.md');
      }
      const server = applicationMcpServerName(digest(snapshot.taskId));
      for (const bridge of snapshot.mcp) if (bridge.kind === 'applications') bridge.serverName = server;
      snapshot.adapterBinding.nativeToolNames = Object.fromEntries(Object.keys(selected.toolContractMajors).map(name => [name,'mcp__' + server + '__' + name]));
      const saved = await f.sessions.create(snapshot,f.home);
      second = await f.runs.reserve({taskId:snapshot.taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[]});
      await second.prepare(); await second.cli.arm();
      (f.reader as FixtureProcessReader).identities.set(200004,'darwin-proc-v1:200:4'); await second.cli.attach(200004);
      expect(await service.call(second.runId,randomUUID(),call('too-long'))).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
      expect(await service.call(second.runId,randomUUID(),call('new'))).toMatchObject({status:'ok',value:{value:'new',packageHash:next.packageHash}});
      expect(await service.call(run.runId,randomUUID(),call('old-still-long'))).toMatchObject({status:'ok',value:{value:'old-still-long',packageHash:f.application!.packageHash}});
      expect(compile).toHaveBeenCalledTimes(4);
    } finally { if (second) await second.cli.exited(); compile.mockRestore(); }
  });
'''
assert t.count(needle)==1;t=t.replace(needle,tests+needle);(c/'tool-service.test.ts').write_text(t);(c/'tool-service.test.patch').write_text(''.join(difflib.unified_diff(testbase.splitlines(True),t.splitlines(True),fromfile='a/src/main/core/applications/__tests__/tool-service.test.ts',tofile='b/src/main/core/applications/__tests__/tool-service.test.ts')))
plan={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'defect':'M12-PERF-SCHEMA-RETENTION','confirmed':'Actual App019 gateway freshly parses identical no-$id input/output schemas; actual packaged SDK retains compiled schema environments by object. Forty repeated calls produced80 extra environments vs2 with stable schema objects. Same validation results.','boundary':'Does not prove all previous RSS growth is from this path; current P089 oldbaseline stillrunning and immutable.','candidateOnly':True,'productionApplied':False,'sourceBaseSha256':hashlib.sha256(base.encode()).hexdigest(),'testBaseSha256':hashlib.sha256(testbase.encode()).hexdigest(),'fix':'Reuse existing CapabilityExecution memo pattern, keyentry/packageHash/operation/major/input-output; preserve lazy input before output, auth and integrity every call.','plannedNativeVerification':['New public ToolService regression: samecontract8freshrequests, fresh badinput/badoutput/authrevocation/packagebytecorruption all still checked; only2compilers','Two actual immutable package versions with maxLength3 vs1000 in same service retain separate constraints','Affected original ToolService/CLI gateways/lifecycle/error tests then types/newpackaged App and original30min rerun'],'resources':'No native unit/App/build while P089 lease held; prepare candidate/types only'}
(root/'candidate-plan.json').write_text(json.dumps(plan,indent=2)+'\n');print('Private candidate +2 meaningful regression cases prepared; no production edits/Native tests')
