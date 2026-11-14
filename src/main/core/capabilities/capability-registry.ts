import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppDb } from '../../db/client';
import { capabilityRegistry, capabilityRegistryPreferences } from '../../db/schema';
import type { CapabilityRegistryView, ManagedCapabilityView } from '@shared/managed-capabilities';
import { discoverCapabilities, type DiscoveryContext } from './discovery';
import type { DiscoveredCapability } from '@shared/capabilities';
import { applyMcpNativePolicy, mcpReferenceNames, McpSourceError, parseMcpSource, resolveMcpSource, type McpSource, type McpNativePolicy } from './mcp-source';

type Row = typeof capabilityRegistry.$inferSelect;
export interface CapabilityScanContext extends DiscoveryContext { projectRoot?: string; configurationId?:string; sourceEnvironment?:Record<string,string>;secretEnvNames?:string[] }
export interface PluginSkillSource {appId:string;pluginName:string;id:string;path:string;version:string;enabled:boolean}
const hostNames = new Set(['smartdd-project-context','smartdd-project-db-diagnostics','smartdd-remote-password-ssh','willyou-project-db-diagnostics','willyou-remote-password-ssh']);
const physical = (p:string) => {try{return realpathSync(p);}catch{return resolve(p);}};
function sourceIdentity(item:DiscoveredCapability,context:CapabilityScanContext,definition?:Record<string,unknown>,policy?:McpNativePolicy){
  // CLI-native plugin resources are external sources the user can adopt. Only
  // hook-provided WillYou plugin skills below use the protected `plugin` scope.
  const sourceScope:ManagedCapabilityView['sourceScope']=hostNames.has(item.name)?'host':item.source.includes('project')?'project':'user';
  const localRoot=item.path.match(/^(.*?)\/(?:\.claude|\.agents|\.codex)\//)?.[1]??(item.path.endsWith('/.mcp.json')?dirname(item.path):null);
  const projectRoot=sourceScope==='project'?physical(localRoot??context.projectRoot??context.cwd):null;
  const inlineIdentity=item.kind==='mcp'?context.configurationId??(item.path==='profile arguments'?createHash('sha256').update(JSON.stringify(context.args??[])).digest('hex'):null):null;
  const key=[item.kind,resolve(item.path),item.kind==='mcp'?item.name:null,projectRoot,inlineIdentity];
  let environmentIdentity:unknown=null;
  if(item.kind==='mcp'&&definition){
    try{
      const source=parseMcpSource(item.name,item.runner,definition),names=new Set(mcpReferenceNames(source,context.sourceEnvironment??{}));
      // A bare command is looked up in the source launch PATH. Environment
      // unrelated to this MCP (for example another model key) must not create
      // duplicate capabilities. Secret references cannot be compared by scan.
      if(source.command&&!source.command.includes('/'))names.add('PATH');
      environmentIdentity=[...names].sort().map(name=>[name,context.secretEnvNames?.includes(name)?['saved-secret',context.configurationId]:context.sourceEnvironment?.[name]??null]);
    }catch{
      // Unsupported declarations cannot be converted in any context. A shared
      // physical file must still appear once; inline definitions retain their
      // separate profile identity below. No values are compared or persisted.
      environmentIdentity=['unparsed'];
    }
  }
  const policyIdentity=policy?{...policy,allow:policy.allow.filter(x=>x==='*'||x.startsWith('mcp__')),deny:policy.deny.filter(x=>x==='*'||x.startsWith('mcp__')),ask:policy.ask.filter(x=>x==='*'||x.startsWith('mcp__'))}:null;
  return {sourceScope,projectRoot,id:createHash('sha256').update(JSON.stringify(key)).digest('hex'),canonical:JSON.stringify([item.kind,physical(item.path),item.kind==='mcp'?item.name:null,projectRoot,item.path==='profile arguments'?inlineIdentity:null,environmentIdentity,policyIdentity])};
}

/** A generated link is not a new source. Ownership requires both the journal and
 * the exact current inode/readlink, never just a familiar name or path prefix. */
function managedLink(file:string):boolean {
  try {
    const target=dirname(file),s=lstatSync(target);
    if(!s.isSymbolicLink())return false;
    const journalPath=join(dirname(target),'.willyou-managed.json'),jstat=lstatSync(journalPath);
    if(!jstat.isFile()||jstat.isSymbolicLink()||jstat.size>1024*1024)return false;
    const j=JSON.parse(readFileSync(journalPath,'utf8'));
    const e=j?.owner==='WillYou'&&j?.schema===1?j.entries?.[target.split('/').at(-1)!]:null;
    return Boolean(e&&e.inode===s.ino&&e.device===s.dev&&e.source===readlinkSync(target));
  }catch{return false;}
}

/** Persist discovery and user decisions without storing raw MCP configuration.
 * The caller supplies trusted contexts; renderer input never chooses scan roots.
 * A managed row records consent, not a claim that a CLI loaded the capability.
 */
export class CapabilityRegistryService {
  private targetIssues=new Map<string,ManagedCapabilityView['targetIssues']>();
  constructor(private readonly db:AppDb,private readonly contexts:()=>CapabilityScanContext[],private readonly now=()=>Date.now(),private readonly hooks:{revoke?:(id:string)=>void;afterScan?:()=>void;pluginSkills?:()=>PluginSkillSource[]}={}){
    this.db.insert(capabilityRegistryPreferences).values({id:1,autoManage:false}).onConflictDoNothing().run();
  }
  list():CapabilityRegistryView {
    const rows=this.db.select().from(capabilityRegistry).all();
    const pluginItems:ManagedCapabilityView[]=(this.hooks.pluginSkills?.()??[]).map(item=>({id:createHash('sha256').update(JSON.stringify(['plugin',item.appId,item.id])).digest('hex'),kind:'skill',name:item.id,runner:'codex',sourcePath:item.path,sourceScope:'plugin',projectRoot:null,sourceLabel:item.pluginName,version:item.version,managed:false,enabled:item.enabled,autoApprove:false,present:true,status:'plugin',issues:[],loaded:'unverified'}));
    const items=[...rows.map(row=>this.view(row,rows)),...pluginItems];
    return {items,autoManage:this.db.select().from(capabilityRegistryPreferences).get()?.autoManage??false,newCount:items.filter(x=>x.status==='new').length};
  }
  scan():CapabilityRegistryView {
    const found=new Map<string,Omit<Row,'managed'|'enabled'|'autoApprove'|'discoveredAt'>>(),at=this.now();
    const previous=this.db.select().from(capabilityRegistry).all(),knownIds=new Set(previous.map(x=>x.id)),seenSources=new Map<string,string>();
    const targetIssues=new Map<string,ManagedCapabilityView['targetIssues']>();
    const projectGit=new Map<string,'repository'|'none'|'unverified'>();
    for(const context of this.contexts()){
      const definitions=new Map<DiscoveredCapability,{definition:Record<string,unknown>;policy?:McpNativePolicy}>();
      for(const item of discoverCapabilities({...context,onMcpDefinition:(item,definition,policy)=>definitions.set(item,{definition,policy})})){
        if(item.kind==='skill'&&managedLink(item.path))continue;
        const raw=definitions.get(item);
        const {sourceScope,projectRoot,id,canonical}=sourceIdentity(item,context,raw?.definition,raw?.policy);
        // A source visible through several CLI/root scans has one record. Keep
        // the original user alias in sourcePath so updates/deletion follow it.
        const seen=seenSources.get(canonical);
        if(seen){
          // Prefer an existing selected alias, so an installer replacing its
          // symlink/version directory does not silently lose the user's consent.
          if(!previous.some(x=>x.id===id&&x.managed)||previous.some(x=>x.id===seen&&x.managed))continue;
          found.delete(seen);
        }
        seenSources.set(canonical,id);
        if(found.has(id))continue;
        if(raw){
          const diagnostics:NonNullable<ManagedCapabilityView['targetIssues']>={};
          for(const target of ['claude','codex'] as const)try{
            const source=applyMcpNativePolicy(parseMcpSource(item.name,item.runner,raw.definition),raw.policy);
            if(item.enabled===false)source.enabled=false;
            resolveMcpSource(source,context.sourceEnvironment??{},target);
            if(target==='claude'&&source.allowedTools!==null)throw new McpSourceError('来源工具白名单尚不能等价转换到 Claude Code；请在目标 CLI 单独配置');
          }catch(error){
            diagnostics[target]=error instanceof McpSourceError?error.variable&&context.secretEnvNames?.includes(error.variable)?'所需来源变量将在启动时核验':error.message:'来源配置需在 CLI 中修复';
          }
          targetIssues.set(id,diagnostics);
        }
        const issues=[...item.issues,...(item.enabled===false?['source_disabled']:[])];
        if(item.kind==='skill'&&projectRoot){
          if(!projectGit.has(projectRoot)){
            const probe=spawnSync('git',['-C',projectRoot,'rev-parse','--git-path','info/exclude'],{encoding:'utf8',timeout:5000,maxBuffer:128*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:projectRoot,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'}});
            projectGit.set(projectRoot,probe.status===0?'repository':/not a git repository/.test(probe.stderr??'')?'none':'unverified');
          }
          const git=projectGit.get(projectRoot);
          if(git==='none')issues.push('project_not_git');
          else if(git==='unverified')issues.push('project_git_unverified');
        }
        found.set(id,{id,kind:item.kind,name:item.name,runner:item.runner,sourcePath:item.path,sourceScope,projectRoot,sourceLabel:item.source,version:item.version,
          validity:item.validity,issues:JSON.stringify(issues),present:true,scannedAt:at});
      }
    }
    this.db.transaction(()=>{
      // Only a completed scan marks absence. Parsing failures stay visible as
      // their own invalid rows; managed sources are retained as tombstones.
      this.db.update(capabilityRegistry).set({present:false,scannedAt:at}).run();
      for(const item of found.values())this.db.insert(capabilityRegistry).values({...item,managed:false,enabled:true,autoApprove:false,discoveredAt:at})
        .onConflictDoUpdate({target:capabilityRegistry.id,set:item}).run();
      if(this.list().autoManage)this.adoptAvailable(new Set([...found.keys()].filter(id=>!knownIds.has(id))));
    });
    this.targetIssues=targetIssues;this.hooks.afterScan?.();return this.list();
  }
  setAutoManage(enabled:boolean):CapabilityRegistryView {
    if(typeof enabled!=='boolean')throw new Error('自动纳管设置无效');
    this.db.insert(capabilityRegistryPreferences).values({id:1,autoManage:enabled}).onConflictDoUpdate({target:capabilityRegistryPreferences.id,set:{autoManage:enabled}}).run();
    return this.list();
  }
  adoptAll():CapabilityRegistryView {this.db.transaction(()=>this.adoptAvailable());return this.list();}
  private adoptAvailable(only?:Set<string>){
    for(const item of this.list().items)if(item.status==='new'&&(!only||only.has(item.id)))this.db.update(capabilityRegistry).set({managed:true}).where(eq(capabilityRegistry.id,item.id)).run();
  }
  setManaged(id:string,managed:boolean):CapabilityRegistryView {
    if(typeof managed!=='boolean')throw new Error('纳管设置无效');
    const item=this.list().items.find(x=>x.id===id);if(!item)throw new Error('能力已不存在，请重新扫描');
    if(['plugin','host'].includes(item.sourceScope))throw new Error('此能力由插件或宿主管理');
    if(managed&&item.status!=='new'&&item.status!=='managed')throw new Error('请先处理来源异常或同名冲突');
    if(!managed)this.hooks.revoke?.(id);
    this.db.update(capabilityRegistry).set({managed,...(!managed?{autoApprove:false}:{})}).where(eq(capabilityRegistry.id,id)).run();return this.list();
  }
  setEnabled(id:string,enabled:boolean):CapabilityRegistryView {
    if(typeof enabled!=='boolean')throw new Error('启用设置无效');const row=this.requireManaged(id);
    if(!enabled)this.hooks.revoke?.(id);
    this.db.update(capabilityRegistry).set({enabled}).where(eq(capabilityRegistry.id,row.id)).run();return this.list();
  }
  setAutoApprove(id:string,approved:boolean):CapabilityRegistryView {
    if(typeof approved!=='boolean')throw new Error('审批设置无效');const row=this.requireManaged(id);if(row.kind!=='mcp')throw new Error('只有 MCP 可以配置工具审批');
    this.db.update(capabilityRegistry).set({autoApprove:approved}).where(eq(capabilityRegistry.id,id)).run();return this.list();
  }
  selected(projectRoot:string):ManagedCapabilityView[]{
    const applicable=this.list().items.filter(x=>x.present&&(!x.projectRoot||x.projectRoot===physical(projectRoot))&&!['host','plugin','invalid'].includes(x.status));
    return applicable.filter(x=>x.managed&&x.enabled&&!applicable.some(other=>other.id!==x.id&&other.kind===x.kind&&other.name===x.name));
  }
  /** Fresh main-process resolution only. Raw MCP values are neither persisted
   * nor included in any renderer-safe registry view or task snapshot. */
  resolveMcpSource(id:string):{source:McpSource;environment:Record<string,string>;configurationId?:string;secretEnvNames?:string[]}|null {
    const row=this.db.select().from(capabilityRegistry).where(eq(capabilityRegistry.id,id)).get();
    if(!row||row.kind!=='mcp'||!row.managed||!row.enabled||!row.present)return null;
    for(const context of this.contexts()){
      let match:{source:McpSource;environment:Record<string,string>;configurationId?:string;secretEnvNames?:string[]}|null=null;
      discoverCapabilities({...context,onMcpDefinition:(item,definition,policy)=>{
        if(sourceIdentity(item,context,definition,policy).id!==id)return;
        const source=applyMcpNativePolicy(parseMcpSource(item.name,item.runner,definition),policy);
        if(item.enabled===false)source.enabled=false;
        match={source,environment:{...context.sourceEnvironment},secretEnvNames:context.secretEnvNames??[],...(context.configurationId?{configurationId:context.configurationId}:{})};
      }});
      if(match)return match;
    }
    return null;
  }
  private requireManaged(id:string){const row=this.db.select().from(capabilityRegistry).where(eq(capabilityRegistry.id,id)).get();if(!row?.managed)throw new Error('请先纳管此能力');return row;}
  private view(row:Row,all:Row[]):ManagedCapabilityView {
    const issues:string[]=JSON.parse(row.issues);
    const sourceScope=row.sourceScope as ManagedCapabilityView['sourceScope'];
    // Discovery sees SKILL.md files, but a user's plain file or dangling link
    // at the future Codex target must also block adoption. This check is read-only
    // and runs on every view so removing/replacing a target is reflected promptly.
    let targetConflict=false;
    if(row.kind==='skill'&&row.projectRoot&&!['host','plugin'].includes(sourceScope)){
      const target=join(row.projectRoot,'.agents/skills',row.name);
      try{lstatSync(target);targetConflict=physical(target)!==physical(dirname(row.sourcePath));}
      catch(error){targetConflict=(error as NodeJS.ErrnoException).code!=='ENOENT';}
      if(targetConflict)issues.push('skill_target_conflict');
    }
    const conflict=targetConflict||all.some(other=>other.id!==row.id&&other.present&&other.kind===row.kind&&other.name===row.name&&
      !['host','plugin'].includes(other.sourceScope)&&(!row.projectRoot||!other.projectRoot||row.projectRoot===other.projectRoot));
    const present=row.present&&(row.kind==='mcp'||existsSync(row.sourcePath));
    const status:ManagedCapabilityView['status']=sourceScope==='host'?'host':sourceScope==='plugin'?'plugin':!present?'missing':conflict?'conflict':row.validity==='invalid'||issues.includes('source_disabled')?'invalid':row.managed?'managed':'new';
    return {id:row.id,kind:row.kind as 'skill'|'mcp',name:row.name,runner:row.runner as ManagedCapabilityView['runner'],sourcePath:row.sourcePath,sourceScope,projectRoot:row.projectRoot,sourceLabel:row.sourceLabel,version:row.version,managed:row.managed,enabled:row.enabled,autoApprove:row.autoApprove,present,status,issues,loaded:'unverified',...(row.kind==='mcp'?{targetIssues:this.targetIssues.get(row.id)??{}}:{})};
  }
}
