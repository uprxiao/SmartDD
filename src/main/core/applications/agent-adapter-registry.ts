import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import {BRIDGE_LIMITS} from '@shared/application-bridge';
import { agentAdapterMetadataSchema, agentLoadPlanSchema,libraryLoadRequestSchema, type LibraryLoadRequest, type AgentAdapterMetadata, type LaunchMcpServer, type AgentLoadPlan, type AgentLevel } from '@shared/agent-adapters';
import type { CapabilitySessionSnapshot } from '@shared/application-session';
import { canonicalJson, digest } from './manifest';
import { effectiveLevels, type EffectiveLevels } from './agent-levels';
import { builtinNativeEvidenceAdapters, type NativeEvidenceAdapterRegistry } from './native-evidence-adapters';
import { checkNativeFormat, readNativeFormatCheck, storeNativeFormatCheck, type NativeFormatCheckFixtures } from './agent-format-self-check';
import { builtinCapabilityDeliveryAdapters, type CapabilityDeliveryAdapterRegistry } from './capability-delivery-adapters';
import {readApplicationRunPlan} from './run-plan';
import { ownedBundle, writeOwnedBundle, verifyOwnedBundle, type OwnedBundleManifest } from './owned-bundle';
import type { PublishResource, ResourceRecord, ResourceStore } from './resource-store';
export interface NativeBridgeReplacement {
  runId:string;serverName:string;bridgeInstanceId:string;generation:number;bootstrapPath:string;signal:AbortSignal;
}
interface AdapterRow { agent_id: string;version: string;adapter_hash: string;resource_id: string;manifest_json: string }
export interface InstalledAgentAdapter { metadata: AgentAdapterMetadata;hash: string;resource: ResourceRecord;manifest: OwnedBundleManifest }
const loader = createRequire(import.meta.url);
/** Codex's model history has a separate MCP output ceiling. Align only the
 * verified application's declared tools with the already bounded host result.
 * The byte ceiling is a conservative token ceiling, including JSON escaping
 * and the MCP text/structured representations. This adds no tool or authority.
 * Host transport policy also applies to retained adapters without changing
 * their immutable bytes or the session's fixed package/adapter selection. */
function codexToolBudget(plan:AgentLoadPlan,cliVersion:string,mcp:readonly LaunchMcpServer[],declared:readonly string[]):AgentLoadPlan{
  if(plan.agentId!=='codex'||!['0.162.1','0.166.0'].includes(cliVersion))return plan;
  const bridge=mcp.find(m=>m.kind==='applications');if(!bridge)return plan;
  const names=[...new Set(declared)].sort();
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
    // R1.0 (2026-11-04): library delivery works on every version of the Agent; only declared versions get the CLI sandbox.
    if(meta.skillDelivery==='library'&&/^\d+\.\d+\.\d+$/.test(cliVersion))return 'best-effort';
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
  private assertBridges(snapshot:CapabilitySessionSnapshot,input:Pick<LibraryLoadRequest,'mcp'|'currentExecutable'|'runId'>):void{
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
  }
  /** M11 R1.0: Skills are already in the shared library; this plans only the bridges and CLI permission profile. */
  planLibrary(hash:string,value:LibraryLoadRequest):AgentLoadPlan{
    const parsed=libraryLoadRequestSchema.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','Agent加载计划包含未允许字段或格式错误');
    const input=parsed.data,installed=this.verify(hash),meta=installed.metadata,snapshot=input.snapshot;
    if(meta.skillDelivery!=='library')throw new ApplicationError('HOST_INCOMPATIBLE','此适配器不按统一Skill库交付');
    if(snapshot.runner!==meta.agentId||snapshot.adapterBinding.hash!==installed.hash||snapshot.adapterBinding.id!==meta.agentId||snapshot.adapterBinding.version!==meta.version)throw new ApplicationError('SNAPSHOT_CORRUPT','固定适配器与原快照不一致');
    const support=this.versionSupport(installed.hash,input.cliVersion);
    if(support==='unsupported')throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','此Agent／平台版本尚未验证所需加载机制，保留Agent原功能');
    if(support==='best-effort'&&input.cliSandbox)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','未声明版本不能注入CLI端点或沙箱放宽');
    if(input.native.runner!==snapshot.runner||input.native.stateRoot!==snapshot.native.stateRoot||input.native.cwd!==snapshot.native.cwd||input.native.sessionId!==snapshot.native.sessionId)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','加载时的原生身份或目录已改变');
    const runPlan=readApplicationRunPlan(this.store,input.runId,input.planHash);
    if(runPlan.taskId!==snapshot.taskId||runPlan.projectId!==snapshot.projectId)throw new ApplicationError('SCOPE_DENIED','运行计划不属于本任务');
    if(input.cliSandbox&&(meta.cliEntry!=='supported'||!runPlan.grades.cli||input.cliSandbox.digest!==runPlan.sandbox.digest||input.cliSandbox.source!==runPlan.sandbox.source))throw new ApplicationError('SCOPE_DENIED','沙箱交付不等于本次运行策略');
    this.assertBridges(snapshot,input);
    for(const item of input.inventory)if(item.kind==='mcp'&&input.mcp.some(m=>m.serverName===item.name)&&item.ownerStoreId!==this.store.storeId)throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','用户MCP名称与受管工具桥冲突，保留用户配置且不自动改名');
    try{
      const module=loader(join(this.store.root,installed.resource.relativePath,meta.entry)) as {api:number;agentId:string;version:string;prepare(input:unknown):unknown};
      if(module.api!==1||module.agentId!==meta.agentId||module.version!==meta.version||typeof module.prepare!=='function')throw new Error();
      const plan=agentLoadPlanSchema.parse(module.prepare({...input,mcpConfigPath:join(this.store.root,'runs',snapshot.projectId,snapshot.taskId,input.runId,'mcp.json')}));
      if(plan.agentId!==snapshot.runner||plan.bridgeRecovery!==meta.bridgeRecovery)throw new Error();
      return codexToolBudget(plan,input.cliVersion,input.mcp,snapshot.packages.flatMap(p=>Object.keys(p.toolContractMajors)));
    }catch{throw new ApplicationError('HOST_INCOMPATIBLE','Agent适配器无法安全生成本次加载参数');}
  }
  verifyReference(resource: ResourceRecord,snapshot: CapabilitySessionSnapshot): void { const installed = this.verify(snapshot.adapterBinding.hash); if (resource.resourceId !== installed.resource.resourceId) throw new ApplicationError('SNAPSHOT_CORRUPT','适配资源不属于原会话'); }
}
