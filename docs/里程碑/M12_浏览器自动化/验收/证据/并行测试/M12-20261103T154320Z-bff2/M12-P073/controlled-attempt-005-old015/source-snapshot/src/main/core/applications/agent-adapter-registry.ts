import {validateNativeDiscoveryExclusions,nativeGuardPlanOmissions,type NativeGuardDiscoveryProof} from './native-discovery-exclusions';
import {claudeProjectionSelection,selectedStandardSkills} from './claude-projection-selection';
import {assertClaudeRunDelivery,verifyClaudeDelivery} from './claude-delivery-state';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative } from 'node:path';
import { ApplicationError } from '@shared/applications';
import {BRIDGE_LIMITS} from '@shared/application-bridge';
import { agentAdapterMetadataSchema, agentLoadRequestSchema, agentLoadPlanSchema,legacyAgentLoadRequestSchema, type AgentAdapterMetadata, type AgentLoadRequest, type AgentLoadPlan, type AgentLevel } from '@shared/agent-adapters';
import type { CapabilitySessionSnapshot } from '@shared/application-session';
import { canonicalJson, digest } from './manifest';
import { effectiveLevels, type EffectiveLevels } from './agent-levels';
import { builtinNativeEvidenceAdapters, type NativeEvidenceAdapterRegistry } from './native-evidence-adapters';
import { checkNativeFormat, readNativeFormatCheck, storeNativeFormatCheck, type NativeFormatCheckFixtures } from './agent-format-self-check';
import { builtinCapabilityDeliveryAdapters, type CapabilityDeliveryAdapterRegistry } from './capability-delivery-adapters';
import {applicationSkillSnapshotView} from './application-skill-view';
import {readApplicationRunPlan,skillFilesHash} from './run-plan';
import {readFileSync} from 'node:fs';
import {legacyPlannerInput} from './legacy-agent-load';
import {verifyLegacyDiscoveryEntry} from './legacy-discovery';
import { ownedBundle, writeOwnedBundle, verifyOwnedBundle, type OwnedBundleManifest } from './owned-bundle';
import type { PublishResource, ResourceRecord, ResourceStore } from './resource-store';
export interface NativeBridgeReplacement {
  runId:string;serverName:string;bridgeInstanceId:string;generation:number;bootstrapPath:string;signal:AbortSignal;
}
interface AdapterRow { agent_id: string;version: string;adapter_hash: string;resource_id: string;manifest_json: string }
export interface InstalledAgentAdapter { metadata: AgentAdapterMetadata;hash: string;resource: ResourceRecord;manifest: OwnedBundleManifest }
const loader = createRequire(import.meta.url);
const within = (root: string,path: string): boolean => { const r = relative(root,path); return r === '' || (!r.startsWith('..') && !r.startsWith('/')); };
/** Codex's model history has a separate MCP output ceiling. Align only the
 * verified application's declared tools with the already bounded host result.
 * The byte ceiling is a conservative token ceiling, including JSON escaping
 * and the MCP text/structured representations. This adds no tool or authority.
 * Host transport policy also applies to retained adapters without changing
 * their immutable bytes or the session's fixed package/adapter selection. */
function codexOutputBudget(plan:AgentLoadPlan,input:AgentLoadRequest):AgentLoadPlan{
  if(plan.agentId!=='codex'||!['0.162.1','0.166.0'].includes(input.cliVersion))return plan;
  const bridge=input.mcp.find(m=>m.kind==='applications');if(!bridge)return plan;
  const names=[...new Set(input.snapshot.packages.filter(p=>input.applicationScope===undefined||input.applicationScope.includes(p.appId)).flatMap(p=>Object.keys(p.toolContractMajors)))].sort();
  if(!names.length)return plan;
  const tools=names.map(name=>JSON.stringify(name)+'={output_token_limit='+BRIDGE_LIMITS.responseBytes+'}').join(',');
  return agentLoadPlanSchema.parse({...plan,args:[...plan.args,'-c','mcp_servers.'+bridge.serverName+'.tools={'+tools+'}']});
}
/** Adapters published before the M11 level table keep their original verified native message formats. */
const RETAINED_NATIVE_MESSAGE_FORMATS: Readonly<Record<string, readonly string[]>> = { 'claude-code': ['2.1.303'], codex: ['0.162.1'] };
export class AgentAdapterRegistry {
  constructor(readonly store: ResourceStore, private readonly nativeFormats: NativeEvidenceAdapterRegistry = builtinNativeEvidenceAdapters, readonly deliveryAdapters: CapabilityDeliveryAdapterRegistry = builtinCapabilityDeliveryAdapters) {}
  /** Single read point for declared levels (§15.4). Undeclared versions get no level; fail closed. */
  levels(hash:string,cliVersion:string):readonly AgentLevel[]{
    const declared=this.declaredLevels(hash,cliVersion), check=this.selfCheckResult(hash,cliVersion);
    return check?.status==='passed'?[...new Set([...declared,...check.proven])]:declared;
  }
  private declaredLevels(hash:string,cliVersion:string):readonly AgentLevel[]{
    const meta=this.get(hash).metadata;if(!meta.cliVersions.includes(cliVersion))return [];
    if(meta.levels)return meta.levels[cliVersion]??[];
    return RETAINED_NATIVE_MESSAGE_FORMATS[meta.agentId]?.includes(cliVersion)?['L0.skill','L0.mcp','L1','L2','L3']:[];
  }
  /** Declared levels after the undeclared-version downgrade (§15.4). Diagnostics and delivery read this. */
  effective(hash:string,cliVersion:string):EffectiveLevels{
    const declared=effectiveLevels(this.declaredLevels(hash,cliVersion)),check=this.selfCheckResult(hash,cliVersion);
    return check?.status==='passed'?{...declared,levels:[...new Set([...declared.levels,...check.proven])]}:declared;
  }
  /** Host-only, deliberately absent from RPC/MCP. A format check proves neither CLI identity nor authorization. */
  selfCheck(hash:string,cliVersion:string,fixtures:NativeFormatCheckFixtures){
    const installed=this.verify(hash), result=checkNativeFormat(this.nativeFormats.get(installed.metadata.agentId),hash,cliVersion,fixtures);
    this.verify(hash);storeNativeFormatCheck(this.store,result);return result;
  }
  selfCheckResult(hash:string,cliVersion:string){const result=readNativeFormatCheck(this.store,hash,cliVersion);if(result)this.verify(hash);return result;}
  versionSupport(hash:string,cliVersion:string):'declared'|'best-effort'|'unsupported'{
    const meta=this.get(hash).metadata;
    if(!meta.platforms.includes(`${process.platform}-${process.arch}` as 'darwin-arm64'))return 'unsupported';
    if(meta.cliVersions.includes(cliVersion))return 'declared';
    return meta.projectionFormatVersion===1&&/^\d+\.\d+\.\d+$/.test(cliVersion)&&this.deliveryAdapters.get(meta.agentId).bestEffortMcp===true?'best-effort':'unsupported';
  }
  recovery(hash:string,cliVersion:string):{capability:AgentAdapterMetadata['bridgeRecovery'];evidence?:string;replace?:(request:NativeBridgeReplacement)=>Promise<void>} {
    const installed=this.verify(hash),meta=installed.metadata;
    if(!meta.cliVersions.includes(cliVersion)||!meta.platforms.includes(`${process.platform}-${process.arch}` as 'darwin-arm64'))return{capability:'unverified'};
    if(meta.bridgeRecovery!=='supported')return{capability:meta.bridgeRecovery};
    const evidence=meta.recoveryEvidence?.find(item=>item.cliVersion===cliVersion)?.baseline;
    const module=loader(join(this.store.root,installed.resource.relativePath,meta.entry)) as {agentId?:string;version?:string;replaceBridge?:(request:NativeBridgeReplacement)=>Promise<void>};
    if(!evidence||meta.recoveryRequiresAgentRestart!==false||meta.configReload!=='supported'||meta.recoveryEntry!=='replaceBridge'||module.agentId!==meta.agentId||module.version!==meta.version||typeof module.replaceBridge!=='function')throw new ApplicationError('HOST_INCOMPATIBLE','独立恢复声明缺少原适配器的已验证入口');
    return{capability:'supported',evidence,replace:async request=>{
      this.verify(hash); // Recheck the fixed bytes at the moment of invocation.
      if(request.signal.aborted)throw new ApplicationError('CANCELED','本次恢复已取消');
      await module.replaceBridge!(request);
    }};
  }
  async install(metadata: AgentAdapterMetadata,input: Readonly<Record<string,Uint8Array>>): Promise<InstalledAgentAdapter> {
    const parsed = agentAdapterMetadataSchema.safeParse(metadata); if (!parsed.success || !input[metadata.entry]) throw new ApplicationError('INVALID_PACKAGE','Agent适配器声明无效');
    this.deliveryAdapters.get(parsed.data.agentId);
    const bundle = ownedBundle(parsed.data,input), id = `agent-adapter:${metadata.agentId}:${bundle.hash}`;
    const spec: PublishResource = { resourceId: id,kind: 'agent-adapter',contentHash: bundle.hash,relativePath: `agent-adapters/${metadata.agentId}/${metadata.version}/${bundle.hash}`,dependencies: [],materialize: stage => writeOwnedBundle(stage,bundle,this.store.storeId),verify: dir => { verifyOwnedBundle(dir,bundle.hash,this.store.storeId); },register: () => {
      const old = this.store.sqlite.prepare('SELECT adapter_hash FROM capability_agent_adapters WHERE agent_id=? AND version=?').get(metadata.agentId,metadata.version) as { adapter_hash: string } | undefined;
      if (old && old.adapter_hash !== bundle.hash) throw new ApplicationError('VERSION_CONFLICT','同一Agent适配版本已有不同内容');
      if (!old) this.store.sqlite.prepare('INSERT INTO capability_agent_adapters VALUES(?,?,?,?,?)').run(metadata.agentId,metadata.version,bundle.hash,id,canonicalJson(bundle.manifest));
    } };
    const old = this.store.sqlite.prepare('SELECT adapter_hash FROM capability_agent_adapters WHERE agent_id=? AND version=?').get(metadata.agentId,metadata.version) as { adapter_hash: string } | undefined;
    if (old && old.adapter_hash !== bundle.hash) throw new ApplicationError('VERSION_CONFLICT','Agent适配版本不可原地替换');
    await this.store.publish(spec); return this.get(bundle.hash);
  }
  get(hash: string): InstalledAgentAdapter {
    const row = this.store.sqlite.prepare('SELECT * FROM capability_agent_adapters WHERE adapter_hash=?').get(hash) as AdapterRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND','原Agent适配版本不存在');
    const resource = this.store.get(row.resource_id), manifest = JSON.parse(row.manifest_json) as OwnedBundleManifest, metadata = agentAdapterMetadataSchema.parse(manifest.metadata);
    if (digest(canonicalJson(manifest)) !== hash || metadata.agentId !== row.agent_id || metadata.version !== row.version || resource.kind !== 'agent-adapter' || resource.contentHash !== hash || resource.resourceId !== `agent-adapter:${metadata.agentId}:${hash}` || resource.relativePath !== `agent-adapters/${metadata.agentId}/${metadata.version}/${hash}`) throw new ApplicationError('HASH_MISMATCH','Agent适配器记录与原内容身份不同');
    return { metadata,hash,resource,manifest };
  }
  verify(hash: string): InstalledAgentAdapter {
    const installed = this.get(hash); if (installed.resource.state !== 'ready' || installed.resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','Agent适配器尚未就绪');
    const manifest = verifyOwnedBundle(join(this.store.root,installed.resource.relativePath),hash,this.store.storeId);
    if (canonicalJson(manifest) !== canonicalJson(installed.manifest)) throw new ApplicationError('HASH_MISMATCH','Agent适配器完整树已改变'); return installed;
  }
  private preflight(installed: InstalledAgentAdapter,input: AgentLoadRequest,guardOmissions?:ReadonlySet<string>): void {
    const snapshot = input.snapshot, meta = installed.metadata;
    if (snapshot.runner !== meta.agentId || snapshot.adapterBinding.hash !== installed.hash || snapshot.adapterBinding.id !== meta.agentId || snapshot.adapterBinding.version !== meta.version || snapshot.adapterBinding.projectionFormatVersion !== meta.projectionFormatVersion) throw new ApplicationError('SNAPSHOT_CORRUPT','固定适配器与原快照不一致');
    const support=this.versionSupport(installed.hash,input.cliVersion);
    if (support==='unsupported') throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此Agent／平台版本尚未验证所需加载机制，保留Agent原功能');
    if(support==='best-effort'&&input.cliSandbox)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','未声明版本不能注入CLI端点或沙箱放宽');
    if (input.native.runner !== snapshot.runner || input.native.stateRoot !== snapshot.native.stateRoot || input.native.cwd !== snapshot.native.cwd || input.native.sessionId !== snapshot.native.sessionId) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','加载时的原生身份或目录已改变');
    const applications=input.applicationScope===undefined?snapshot.packages:snapshot.packages.filter(p=>input.applicationScope!.includes(p.appId));
    if(input.claudeDelivery&&snapshot.runner!=='claude-code')throw new ApplicationError('INVALID_INPUT','原目录交付依据只适用于Claude');
    if(input.claudeDelivery&&(!input.pluginRoot||!input.pluginHash||input.claudeDelivery.taskId!==snapshot.taskId))throw new ApplicationError('SNAPSHOT_IMMUTABLE','Claude原目录交付必须包含原任务的实际插件路径及hash');
    if(input.applicationScope&&((!this.deliveryAdapters.shared(snapshot.runner)&&!input.claudeDelivery)||snapshot.legacyBinding||new Set(input.applicationScope).size!==input.applicationScope.length||applications.length!==input.applicationScope.length))throw new ApplicationError('INVALID_INPUT','本轮应用加载范围须来自原固定选择且由受支持适配器处理');
    const standards=selectedStandardSkills(snapshot,input.standardSkillScope);
    if(input.standardSkillScope&&snapshot.runner==='claude-code'&&!input.claudeDelivery)throw new ApplicationError('INVALID_INPUT','标准Skill子集须经过本轮Claude原目录交付');
    if(input.applicationSkillDelivery||input.cliSandbox){
      if(!this.deliveryAdapters.shared(snapshot.runner)||meta.cliEntry!=='supported'||!input.applicationSkillDelivery)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此适配器尚未验证本次CLI/Skill交付');
      const delivery=input.applicationSkillDelivery,runPlan=readApplicationRunPlan(this.store,input.runId,delivery.planHash),saved=this.store.sqlite.prepare('SELECT snapshot_hash FROM capability_session_snapshots WHERE task_id=?').get(snapshot.taskId) as {snapshot_hash:string}|undefined;
      if(support==='best-effort'&&(runPlan.grades.cli||runPlan.allowed.some(c=>c.entry==='cli')))throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','未声明版本只能使用本次MCP降级计划');
      if(!saved||runPlan.taskId!==snapshot.taskId||runPlan.projectId!==snapshot.projectId||saved.snapshot_hash!==runPlan.snapshotHash||digest(canonicalJson(snapshot))!==saved.snapshot_hash)throw new ApplicationError('SNAPSHOT_IMMUTABLE','本次交付不能替换原会话选择');
      const expected=runPlan.skills.map(s=>({appId:s.appId,skillId:s.skillId,nativeName:s.nativeName})),actual=delivery.skills.map(s=>({appId:s.appId,skillId:s.skillId,nativeName:s.nativeName}));
      if(canonicalJson(actual)!==canonicalJson(expected))throw new ApplicationError('SCOPE_DENIED','实际Skill交付不等于固定运行计划');
      applicationSkillSnapshotView(snapshot,delivery.skills);
      for(const view of delivery.skills){if(view.path!==join(input.native.home,'.agents/skills',view.nativeName,'SKILL.md'))throw new ApplicationError('OWNERSHIP_CONFLICT','本次交付越过原生发现根');const entry=input.catalog?.entries.find(e=>e.path===view.path&&e.nativeName===view.nativeName&&e.sourceHash===view.sourceHash&&e.storeId===this.store.storeId);if(!entry)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','本次Skill尚未按相同身份发布');const bundle=verifyOwnedBundle(dirname(view.path),entry.projectionHash,this.store.storeId),files=Object.fromEntries(bundle.files.map(f=>[f.path,readFileSync(join(dirname(view.path),f.path))]));if(skillFilesHash(files)!==runPlan.skills.find(s=>s.appId===view.appId&&s.skillId===view.skillId)!.renderedHash)throw new ApplicationError('HASH_MISMATCH','实际Skill内容不等于本次运行摘要');}
      if(input.cliSandbox&&(!runPlan.grades.cli||!runPlan.allowed.some(c=>c.entry==='cli')||input.cliSandbox.digest!==runPlan.sandbox.digest||input.cliSandbox.source!==runPlan.sandbox.source))throw new ApplicationError('SCOPE_DENIED','沙箱交付不等于本次运行策略');
    }
    const skillView=applicationSkillSnapshotView(snapshot,input.applicationSkillDelivery?.skills??[]),allSkills=[...skillView.packages.filter(p=>input.applicationScope===undefined||input.applicationScope.includes(p.appId)).flatMap(p=>p.skills.map(s=>({path:s.projectionPath,name:s.nativeName,hash:s.contentHash}))),...standards.map(s=>({path:s.projectionPath,name:basename(dirname(s.projectionPath)),hash:s.hash}))];
    const excludedH=guardOmissions??validateNativeDiscoveryExclusions(this.store,input,allSkills.map(s=>s.path));
    if (snapshot.runner === 'claude-code' && input.pluginRoot) {
      const expected = join(this.store.root,'sessions',snapshot.taskId,'claude/plugin');
      if (input.pluginRoot !== expected || !input.pluginHash || allSkills.some(s => !within(join(expected,'skills'),s.path))) throw new ApplicationError('SNAPSHOT_IMMUTABLE','Claude必须沿用原会话稳定插件路径');
      if(input.claudeDelivery){if(!input.applicationScope||canonicalJson(input.applicationScope)!==canonicalJson(input.claudeDelivery.appIds)||input.pluginHash!==input.claudeDelivery.hash)throw new ApplicationError('SNAPSHOT_IMMUTABLE','Claude本轮加载范围与原目录交付不同');assertClaudeRunDelivery(this.store,input.runId,input.claudeDelivery);verifyClaudeDelivery(this.store,this.store.get(input.claudeDelivery.resourceId),snapshot);}
      const projection = verifyOwnedBundle(input.pluginRoot,input.pluginHash,this.store.storeId);
      const selected=claudeProjectionSelection(projection,snapshot);if(canonicalJson(selected.appIds)!==canonicalJson(applications.map(p=>p.appId))||canonicalJson(selected.standardSkillScope)!==canonicalJson(standards.map(s=>s.projectionPath)))throw new ApplicationError('SNAPSHOT_IMMUTABLE','实际Claude目录与本轮加载范围不同');
      const selectionHash = digest(canonicalJson({ ...snapshot,native: { ...snapshot.native,sessionId: null } }));
      if (projection.metadata.taskId !== snapshot.taskId || projection.metadata.selectionHash !== selectionHash) throw new ApplicationError('SNAPSHOT_IMMUTABLE','插件投影不属于原固定会话');
    }
    if (this.deliveryAdapters.shared(snapshot.runner)) {
      const catalog = input.catalog; if (!catalog) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','Codex受管目录清单尚未核验');
      if (new Set(catalog.entries.map(e => e.path)).size !== catalog.entries.length || new Set(catalog.entries.map(e => e.nativeName)).size !== catalog.entries.length) throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','Codex受管目录或名称冲突');
      for (const entry of catalog.entries) {
        if(excludedH.has(entry.path))continue;
        if (entry.path !== join(input.native.home,'.agents','skills',entry.nativeName,'SKILL.md')) throw new ApplicationError('OWNERSHIP_CONFLICT','目录清单越过实际HOME的受管发现根');
        if(entry.format==='legacy-tree-v1'){verifyLegacyDiscoveryEntry(entry,input.native.home);continue;}
        const projection = verifyOwnedBundle(dirname(entry.path),entry.projectionHash,entry.storeId);
        if (projection.metadata.kind !== 'codex-agent-projection-v1' || projection.metadata.sourceHash !== entry.sourceHash || projection.metadata.nativeName !== entry.nativeName) throw new ApplicationError('HASH_MISMATCH','共享投影来源摘要或原生名称不同');
      }
      for (const s of allSkills) if (!catalog.entries.some(e => e.path === s.path && e.sourceHash === s.hash && e.nativeName === s.name && e.storeId === this.store.storeId)) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原选Skill未在完整目录中按相同身份登记');
    }
    if (new Set(input.mcp.map(m => m.kind)).size !== input.mcp.length || new Set(input.mcp.map(m => m.serverName)).size !== input.mcp.length) throw new ApplicationError('INVALID_INPUT','本次工具桥重复');
    for (const mcp of input.mcp) {
      const expected = snapshot.mcp.find(m => m.kind === mcp.kind);
      if (!expected || expected.serverName !== mcp.serverName) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','MCP名称必须沿用原快照');
      if (mcp.kind === 'applications') {
        const runtime = this.store.get('runtime:' + expected.runtimeHash), entry = join(this.store.root,runtime.relativePath,'mcp-bridge.cjs');
        if (mcp.command !== input.currentExecutable || input.currentExecutable !== process.execPath || mcp.args.length !== 3 || mcp.args[0] !== entry || mcp.args[1] !== '--bootstrap' || canonicalJson(mcp.env) !== canonicalJson({ ELECTRON_RUN_AS_NODE: '1' })) throw new ApplicationError('HOST_INCOMPATIBLE','业务桥必须使用当前宿主和原固定CJS资源');
      } else {
        const runtime = this.store.get('legacy-runtime:' + expected.runtimeHash);
        if (Object.keys(mcp.env).length || mcp.command !== 'python3' || mcp.args.length !== 2 || mcp.args[0] !== join(this.store.root,runtime.relativePath,'context_mcp.py') || mcp.args[1] !== join(this.store.root,'runs',snapshot.projectId,snapshot.taskId,input.runId,'context.json')) throw new ApplicationError('HOST_INCOMPATIBLE','旧上下文桥必须沿用原资源及本次上下文，配置不含秘密');
      }
    }
    const nativeTools = Object.entries(snapshot.adapterBinding.nativeToolNames).filter(([name])=>!snapshot.packages.some(p=>Object.hasOwn(p.toolContractMajors,name))||applications.some(p=>Object.hasOwn(p.toolContractMajors,name))).map(([,name])=>name);
    for (const item of input.inventory) {
      const own = item.ownerStoreId === this.store.storeId && item.contentHash && ((item.kind === 'skill' && allSkills.some(s => s.path === item.path && s.hash === item.contentHash)) || (item.kind === 'plugin' && item.path === input.pluginRoot && item.contentHash === input.pluginHash));
      if (own) continue;
      if ((item.kind === 'plugin' && snapshot.runner === 'claude-code' && allSkills.length>0 && input.pluginRoot && item.name === 'smartdd-session') || (item.kind === 'skill' && allSkills.some(s => item.name === s.name || item.name === 'smartdd-session:' + s.name)) || (item.kind === 'mcp' && input.mcp.some(m => m.serverName === item.name)) || (item.kind === 'native-tool' && nativeTools.includes(item.name))) throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','用户能力与原固定受管名称冲突，保留用户配置且不自动改名');
    }
  }
  plan(hash:string,value:AgentLoadRequest):AgentLoadPlan{return this.planChecked(hash,value);}
  planNativeGuard(hash:string,value:AgentLoadRequest,proof:NativeGuardDiscoveryProof):AgentLoadPlan{return this.planChecked(hash,value,proof);}
  private planChecked(hash:string,value:AgentLoadRequest,proof?:NativeGuardDiscoveryProof):AgentLoadPlan {
    const parsed = agentLoadRequestSchema.safeParse(value); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','Agent加载计划包含未允许字段或格式错误');
    const input = parsed.data, installed = this.verify(hash);if(installed.metadata.projectionFormatVersion!==1)throw new ApplicationError('HOST_INCOMPATIBLE','旧格式适配器须从原M4来源生成计划');const omitted=proof?nativeGuardPlanOmissions(this.store,proof,input):undefined;this.preflight(installed,input,omitted);
    try {
      const module = loader(join(this.store.root,installed.resource.relativePath,installed.metadata.entry)) as { api: number;agentId: string;version: string;prepare(input: unknown): unknown };
      if (module.api !== 1 || module.agentId !== installed.metadata.agentId || module.version !== installed.metadata.version || typeof module.prepare !== 'function') throw new Error();
      const view=applicationSkillSnapshotView(input.snapshot,input.applicationSkillDelivery?.skills??[]),plan = agentLoadPlanSchema.parse(module.prepare({ ...input,...(input.catalog&&(omitted||input.catalogExclusions)?{catalog:{...input.catalog,entries:input.catalog.entries.filter(e=>!omitted?.has(e.path)&&!input.catalogExclusions?.paths.includes(e.path))}}:{}),snapshot:{...view,packages:view.packages.filter(p=>input.applicationScope===undefined||input.applicationScope.includes(p.appId)),standardSkills:selectedStandardSkills(input.snapshot,input.standardSkillScope)},mcpConfigPath: join(this.store.root,'runs',input.snapshot.projectId,input.snapshot.taskId,input.runId,'mcp.json') })); if (plan.agentId !== input.snapshot.runner || plan.bridgeRecovery !== installed.metadata.bridgeRecovery) throw new Error(); return codexOutputBudget(plan,input); }
    catch (error) { if ((error as { code?: string }).code === 'AGENT_CAPABILITY_NAME_CONFLICT') throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','用户启停设置与固定受管选择冲突，保留原配置'); throw new ApplicationError('HOST_INCOMPATIBLE','原Agent适配器无法安全生成本次加载参数'); }
  }
  planLegacy(hash:string,value:unknown):AgentLoadPlan {
    const parsed=legacyAgentLoadRequestSchema.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','旧格式加载计划含未允许字段或格式无效');
    const input=parsed.data,installed=this.verify(hash),meta=installed.metadata;
    if(meta.projectionFormatVersion!==2||meta.agentId!==input.native.runner)throw new ApplicationError('HOST_INCOMPATIBLE','原M4来源必须使用相应的旧格式适配器');
    if(!meta.platforms.includes(`${process.platform}-${process.arch}` as 'darwin-arm64')||!meta.cliVersions.includes(input.cliVersion))throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此原生版本尚未验证旧能力加载机制');
    const prepared=legacyPlannerInput(this.store,input,installed.hash);
    try{const module=loader(join(this.store.root,installed.resource.relativePath,meta.entry)) as {api:number;agentId:string;version:string;prepare(value:unknown):unknown};if(module.api!==2||module.agentId!==meta.agentId||module.version!==meta.version||typeof module.prepare!=='function')throw Error('legacy adapter');const plan=agentLoadPlanSchema.parse(module.prepare(prepared));if(plan.agentId!==meta.agentId||plan.bridgeRecovery!==meta.bridgeRecovery)throw Error('legacy agent');return plan;}
    catch(error){if((error as {code?:string}).code==='AGENT_CAPABILITY_NAME_CONFLICT')throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','用户启停配置与原M4选择冲突，保留原配置');throw new ApplicationError('HOST_INCOMPATIBLE','原M4适配器无法生成本次加载计划');}
  }
  verifyReference(resource: ResourceRecord,snapshot: CapabilitySessionSnapshot): void { const installed = this.verify(snapshot.adapterBinding.hash); if (resource.resourceId !== installed.resource.resourceId) throw new ApplicationError('SNAPSHOT_CORRUPT','适配资源不属于原会话'); }
}
