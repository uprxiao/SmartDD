import {hasExternalPluginOwner} from './plugins/legacy-routing';
import {ApplicationError} from '@shared/applications';
import {applicationInvocationDeclarations,applicationToolDeclarations,type ApplicationEntry} from '@shared/application-capabilities';
import type {CapabilitySessionSnapshotV3} from '@shared/application-session-v3';
import type {BuiltinPackageRegistry} from './builtin-package-registry';
import {builtinApplicationModules} from './modules';
import type {ResourceStore} from './resource-store';
import type {RunBindingRevision,RunContext} from './run-registry';
import {createApplicationRunPlan} from './run-plan';

type PackageSelection=CapabilitySessionSnapshotV3['packages'][number];

/**
 * R17: a run token only proves who is calling (run, task, project). What the
 * call may do is read from the project's current settings at every call, so an
 * application enabled after launch works in the same run and a disabled one is
 * refused everywhere. The launch plan contributes only what the Agent itself
 * could reach at launch (its CLI/MCP entries), never the application list.
 */
export class CurrentApplicationAuthorization {
  constructor(private readonly store:ResourceStore,private readonly builtin:Pick<BuiltinPackageRegistry,'packages'|'retainedMetadata'>,private readonly modules=builtinApplicationModules){}

  selectedApps(projectId:string):{appId:string;packageHash:string}[]{
    const rows=this.store.sqlite.prepare('SELECT s.app_id AS appId FROM application_project_settings s JOIN application_catalog_state c ON c.app_id=s.app_id WHERE s.project_id=? AND s.enabled=1 AND c.added=1 AND c.enabled=1 ORDER BY s.app_id').all(projectId) as {appId:string}[];
    return rows.filter(({appId})=>this.modules.appIds().some(id=>id===appId)&&!hasExternalPluginOwner(this.store.sqlite,appId)).map(({appId})=>{const active=this.builtin.packages.active(appId);if(!active)throw new ApplicationError('CAPABILITY_UNAVAILABLE','选用应用尚无可用的默认版本');return{appId,packageHash:active.packageHash};});
  }

  bindings(projectId:string,appIds:readonly string[]):RunBindingRevision[]{
    return appIds.flatMap(appId=>{const registered=this.modules.appIds().find(id=>id===appId);if(!registered)throw new ApplicationError('CONFIG_INCOMPATIBLE','应用未在当前构建注册');return this.modules.module(registered).slots.map(slot=>{
      const row=this.store.sqlite.prepare('SELECT b.connection_id,b.identity_revision,r.revision FROM application_binding_slot_revisions r LEFT JOIN application_project_bindings b ON b.project_id=r.project_id AND b.app_id=r.app_id AND b.slot=r.slot WHERE r.project_id=? AND r.app_id=? AND r.slot=?').get(projectId,appId,slot) as {connection_id:string|null;identity_revision:number|null;revision:number}|undefined;
      if(!row)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','项目连接槽修订缺失');return{appId,slot,connectionId:row.connection_id,identityRevision:row.identity_revision,bindingRevision:row.revision};
    });});
  }

  /** The snapshot entry for one enabled package; `skills` is supplied by the caller. */
  packageSelection(projectId:string,packageHash:string,bindings:readonly RunBindingRevision[],skills:PackageSelection['skills']):PackageSelection{
    const p=this.builtin.retainedMetadata(packageHash),m=p.manifest;
    return{appId:p.appId,version:p.version,packageHash,hashAlgorithm:'app-manifest-v1',hostApi:m.hostApi,dataApi:m.dataApi,runtimeHash:m.runtime.hash,toolContractMajors:Object.fromEntries(applicationToolDeclarations(m).map(t=>[t.name,t.contractMajor])),skills,
      bindings:bindings.filter(b=>b.appId===p.appId&&b.connectionId).map(b=>({bindingId:`${projectId}:${p.appId}:${b.slot}`,connectionId:b.connectionId!,identityRevision:b.identityRevision!})),allowedOperations:[...m.permissions],
      entry:m.schema==='smartdd-app-package-v2'?m.entry:'mcp',capabilityContractMajors:Object.fromEntries(this.modules.capabilityViews(m).map(c=>[c.id,c.contractMajor]))};
  }

  /** The registered application that declares `operation` on `entry`, whether or not this project enables it. */
  private owner(operation:string,entry:ApplicationEntry):string|null{
    for(const appId of this.modules.appIds()){
      const active=this.builtin.packages.active(appId);if(!active)continue;
      try{if(applicationInvocationDeclarations(this.builtin.retainedMetadata(active.packageHash).manifest,entry).some(d=>d.name===operation))return appId;}catch{/* An unverifiable package names no owner. */}
    }
    return null;
  }

  private notEnabled(projectId:string,appId:string):ApplicationError{
    const project=this.store.sqlite.prepare('SELECT name FROM projects WHERE id=?').get(projectId) as {name:string}|undefined,name=this.modules.module(appId).presentation.displayName;
    return new ApplicationError('APP_NOT_ENABLED',`请到项目「${project?.name??projectId}」的‘插件’页开启${name}`);
  }

  /**
   * Registered applications with CLI commands that this project has not enabled. The CLI resolves a command against
   * the listed capabilities before calling, so it needs the enable-here guidance up front (T43).
   */
  private notEnabledCommands(projectId:string,apps:readonly {appId:string}[]):{app:string;code:'APP_NOT_ENABLED';message:string}[]{
    const out:{app:string;code:'APP_NOT_ENABLED';message:string}[]=[];
    for(const appId of this.modules.appIds()){
      if(apps.some(a=>a.appId===appId))continue;const active=this.builtin.packages.active(appId);if(!active)continue;
      let manifest;try{manifest=this.builtin.retainedMetadata(active.packageHash).manifest;}catch{continue;}
      if(manifest.schema!=='smartdd-app-package-v2')continue;
      const names=new Set(manifest.capabilities.flatMap(c=>{const fallback=c.binding.fallback as {cli?:{command:readonly string[]}}|undefined;return[c.binding.cli?.command[0],fallback?.cli?.command[0]].filter((v):v is string=>typeof v==='string');}));
      for(const app of names)out.push({app,code:'APP_NOT_ENABLED',message:this.notEnabled(projectId,appId).message});
    }
    return out;
  }

  /** Replace the launch-time application list and allowed table with the project's current ones. */
  view(context:RunContext):RunContext{
    const launch=context.plan;if(!launch||context.snapshot.schema!==3)return context;
    const projectId=context.run.projectId,apps=this.selectedApps(projectId),bindings=context.bindingMode==='run'?[...context.bindings,...this.bindings(projectId,apps.filter(a=>a.appId!=='mail'&&a.appId!=='browser').map(a=>a.appId))]:this.bindings(projectId,apps.map(a=>a.appId));
    // Library Skills are delivered once per machine (R16), not per run; the view carries no per-run Skill paths.
    const packages=apps.map(a=>this.packageSelection(projectId,a.packageHash,bindings,[]));
    const snapshot:CapabilitySessionSnapshotV3={...context.snapshot,packages};
    const applications=apps.map(a=>{const manifest=this.builtin.retainedMetadata(a.packageHash).manifest;return{packageHash:a.packageHash,manifest,capabilities:this.modules.capabilityViews(manifest)};});
    const plan=createApplicationRunPlan({runId:launch.runId,snapshotHash:launch.snapshotHash,snapshot,applications,skills:[],available:{mcp:launch.grades.mcp,cli:launch.grades.cli},cliVersion:launch.cliVersion,sandbox:launch.sandbox,now:launch.createdAt});
    return{...context,recorded:context.snapshot,snapshot,plan,bindings,notEnabledCommands:()=>this.notEnabledCommands(projectId,apps),unavailableApplication:(operation,entry)=>{const appId=this.owner(operation,entry);return appId&&!apps.some(a=>a.appId===appId)?this.notEnabled(projectId,appId):null;}};
  }
}
