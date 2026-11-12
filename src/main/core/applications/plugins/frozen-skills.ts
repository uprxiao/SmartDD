import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,rmdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import type {ApplicationRunPlan} from '@shared/application-run-plan';
import type {NativeLaunchContext} from '../native-launch-context';
import type {ResourceStore} from '../resource-store';
import type {PluginLifecycle} from './lifecycle';
import {canonicalJson,digest} from '../manifest';
import {ensureStoreDirectory} from '../package-files';
import {ownedBundle,verifyOwnedBundle,writeOwnedBundle,type OwnedBundle} from '../owned-bundle';
import {libraryFrontMatter} from '../application-skill-template';
import {renderSkillTemplate,type RunPlanAvailability,pluginCliCommand} from '../run-plan';
import {syncPluginPath} from './data-tree';

const metadataSchema=z.object({schema:z.literal('willyou-plugin-skills-v1'),runId:z.uuid(),taskId:z.string().min(1).max(128),projectId:z.string().min(1).max(128),runner:z.enum(['codex','claude-code'])}).strict();
type Metadata=z.infer<typeof metadataSchema>;
export interface FrozenPluginSkillSet {
  metadata:Metadata;bundle:OwnedBundle;root:string;claudeRoots:string[];codexRoots:string[];
  skills:ApplicationRunPlan['skills'];
}
const shorten=(name:string,max:number)=>name.length<=max?name:name.slice(0,max-9)+'-'+digest(name).slice(0,8);
export const pluginSkillNamespace=(appId:string)=>shorten('willyou-'+appId,31);

/** Per-run copies, never shared discovery or symlinks to the mutable installed package.
 * Only declared Skill subtrees are copied; plugin hooks, MCP manifests and runtime are not loaded as native plugins.
 */
export class FrozenPluginSkills {
  private readonly root:string;
  constructor(private readonly store:ResourceStore,private readonly lifecycle:PluginLifecycle){this.root=ensureStoreDirectory(store.root,'plugin-skills');}
  describe(snapshot:CapabilitySessionSnapshot,runId:string,available:RunPlanAvailability):FrozenPluginSkillSet|undefined {
    const metadata=metadataSchema.parse({schema:'willyou-plugin-skills-v1',runId,taskId:snapshot.taskId,projectId:snapshot.projectId,runner:snapshot.runner}),files:Record<string,Buffer>=Object.create(null),executables=new Set<string>(),skills:ApplicationRunPlan['skills']=[],claudeRoots:string[]=[],codexRoots:string[]=[],root=join(this.root,runId);
    if(snapshot.schema!==3)return;
    for(const selection of snapshot.externalPlugins??[]){
      const stored=this.lifecycle.packages.get(selection.packageHash),plugin=stored.plugin;
      if(plugin.manifest.id!==selection.appId||plugin.manifest.version!==selection.version)throw new ApplicationError('HASH_MISMATCH','插件 Skill 来源与本次快照不符');
      if(!plugin.skills.length)continue;
      const namespace=pluginSkillNamespace(selection.appId),prefix='packages/'+selection.appId+'/',payload=prefix+'payload/';
      const parameters={appId:selection.appId,entrypoints:available[selection.entry]?selection.capabilities.map(cap=>({capabilityId:cap.id,entry:selection.entry,invocation:selection.entry==='cli'?'willyou-app '+pluginCliCommand(selection.appId,cap.id).join(' '):'MCP 工具 '+(snapshot.adapterBinding.nativeToolNames[cap.mcpTool]??cap.mcpTool)})):[]};
      for(const[path,bytes]of plugin.files)if(plugin.skills.some(skill=>path.startsWith(skill.path+'/'))){files[payload+path]=Buffer.from(bytes);if(plugin.executables.has(path))executables.add(payload+path);}
      for(const skill of plugin.skills){
        const skillName=shorten(skill.id,31),nativeName=namespace+(snapshot.runner==='claude-code'?':':'-')+skillName;
        if(skills.some(s=>s.nativeName===nativeName))throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','插件 Skill 名称碰撞，未覆盖已有能力');
        const template=files[payload+skill.entry];if(!template)throw new ApplicationError('INVALID_PACKAGE','插件 Skill 缺少入口');
        const rendered=renderSkillTemplate(template,parameters),bytes=libraryFrontMatter(rendered.bytes,snapshot.runner==='claude-code'?skillName:nativeName);files[payload+skill.entry]=bytes;
        skills.push({appId:selection.appId,skillId:skill.id,nativeName,templateHash:rendered.templateHash,parametersHash:rendered.parametersHash,renderedHash:digest(bytes)});codexRoots.push(join(root,payload,skill.path));
      }
      if(snapshot.runner==='claude-code'){
        // Explicit paths stay under payload, so a package-local .mcp.json/hooks directory is never a wrapper default.
        files[prefix+'.claude-plugin/plugin.json']=Buffer.from(canonicalJson({name:namespace,version:plugin.manifest.version,description:plugin.manifest.description,skills:plugin.skills.map(skill=>'./payload/'+skill.path)})+'\n');claudeRoots.push(join(root,prefix));
      }
    }
    if(!skills.length)return;
    return{metadata,bundle:ownedBundle(metadata,files,executables),root,claudeRoots,codexRoots,skills};
  }
  checkNative(set:FrozenPluginSkillSet,native:Pick<NativeLaunchContext,'inventory'|'userSkillConfig'>):void {
    const namespaces=new Set(set.claudeRoots.map(path=>pluginSkillNamespace(path.split('/').filter(Boolean).at(-1)!)));
    if(native.inventory.some(item=>item.kind==='skill'&&set.skills.some(s=>s.nativeName===item.name)||item.kind==='plugin'&&namespaces.has(item.name))||native.userSkillConfig.some(c=>!c.enabled&&typeof c.name==='string'&&set.skills.some(s=>s.nativeName===c.name)))throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','原生插件或 Skill 已占用此名称，保留用户配置');
  }
  materialize(set:FrozenPluginSkillSet):void {
    const row=this.store.sqlite.prepare('SELECT task_id,project_id,state FROM capability_runs WHERE run_id=?').get(set.metadata.runId) as {task_id:string;project_id:string;state:string}|undefined;
    if(!row||row.task_id!==set.metadata.taskId||row.project_id!==set.metadata.projectId||row.state!=='prepared')throw new ApplicationError('SCOPE_DENIED','Skill 冻结目录必须属于本次已准备运行');
    if(set.root!==join(this.root,set.metadata.runId))throw new ApplicationError('OWNERSHIP_CONFLICT','Skill 冻结路径不属于本次运行');
    if(existsSync(set.root)){this.verify(set);return;}
    const stage=join(this.root,'.staging-'+set.metadata.runId);let created=false,marked=false;
    try{mkdirSync(stage,{mode:0o700});created=true;writeFileSync(join(stage,'owner.json'),canonicalJson({storeId:this.store.storeId,...set.metadata})+'\n',{flag:'wx',mode:0o600});marked=true;syncPluginPath(join(stage,'owner.json'));syncPluginPath(stage);syncPluginPath(this.root);const payload=join(stage,'bundle');writeOwnedBundle(payload,set.bundle,this.store.storeId);verifyOwnedBundle(payload,set.bundle.hash,this.store.storeId);renameSync(payload,set.root);syncPluginPath(stage);syncPluginPath(this.root);this.verify(set);}
    finally{if(created&&existsSync(stage)){if(marked){this.assertStage(stage,set.metadata);rmSync(stage,{recursive:true});}else rmdirSync(stage);syncPluginPath(this.root);}}
  }
  verify(set:FrozenPluginSkillSet):void {
    if(set.root!==join(this.root,metadataSchema.parse(set.metadata).runId))throw new ApplicationError('OWNERSHIP_CONFLICT','Skill 冻结路径归属不符');
    const manifest=verifyOwnedBundle(set.root,set.bundle.hash,this.store.storeId);if(canonicalJson(manifest.metadata)!==canonicalJson(set.metadata))throw new ApplicationError('OWNERSHIP_CONFLICT','Skill 冻结目录身份不同');
  }
  private assertStage(path:string,metadata:Metadata):void {
    const stat=lstatSync(path),file=join(path,'owner.json'),owner=lstatSync(file);
    if(path!==join(this.root,'.staging-'+metadata.runId)||!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(path)!==path||!owner.isFile()||owner.nlink!==1||owner.size>4096||canonicalJson(JSON.parse(readFileSync(file,'utf8')))!==canonicalJson({storeId:this.store.storeId,...metadata}))throw new ApplicationError('OWNERSHIP_CONFLICT','Skill 临时目录归属不符，保留待核查');
  }
  release(runId:string):void {
    z.uuid().parse(runId);const path=join(this.root,runId),stage=join(this.root,'.staging-'+runId);if(!existsSync(path)&&!existsSync(stage))return;
    const row=this.store.sqlite.prepare('SELECT task_id,project_id,state FROM capability_runs WHERE run_id=?').get(runId) as {task_id:string;project_id:string;state:string}|undefined;
    if(!row||row.state!=='stopped')throw new ApplicationError('RESOURCE_BUSY','原运行未确认停止，保留 Skill 冻结目录');
    if(existsSync(path)){const marker=JSON.parse(readFileSync(join(path,'.willyou-owned-bundle.json'),'utf8')),manifest=verifyOwnedBundle(path,z.string().regex(/^[a-f0-9]{64}$/).parse(marker.hash),this.store.storeId),metadata=metadataSchema.parse(manifest.metadata);if(metadata.runId!==runId||metadata.taskId!==row.task_id||metadata.projectId!==row.project_id)throw new ApplicationError('OWNERSHIP_CONFLICT','Skill 目录与原运行记录不一致');rmSync(path,{recursive:true});}
    if(existsSync(stage)){const {storeId:_,...raw}=JSON.parse(readFileSync(join(stage,'owner.json'),'utf8')),metadata=metadataSchema.parse(raw);if(metadata.runId!==runId||metadata.taskId!==row.task_id||metadata.projectId!==row.project_id)throw new ApplicationError('OWNERSHIP_CONFLICT','Skill 临时目录与原运行不同');this.assertStage(stage,metadata);rmSync(stage,{recursive:true});}syncPluginPath(this.root);
  }
  recover():{runId:string;code:string}[]{
    const retained:{runId:string;code:string}[]=[];
    for(const entry of new Set(readdirSync(this.root).map(name=>name.replace(/^\.staging-/,'')))){
      if(!z.uuid().safeParse(entry).success)continue;
      try{this.release(entry);}
      catch(error){retained.push({runId:entry,code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
    }
    return retained;
  }
}
