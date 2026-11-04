import {parseDocument} from 'yaml';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {applicationCapabilityViews,type ApplicationCapability,type ApplicationPackageManifest} from '@shared/application-capabilities';
import {renderSkillTemplate,selectCapabilityEntry,type SkillRenderParameters} from './run-plan';
import {applicationNativeSkillName} from '@shared/application-session';
import {canonicalJson,digest} from './manifest';

const deliverySchema=z.object({schema:z.literal(1),allowedOperations:z.array(z.string()).max(256),available:z.object({mcp:z.boolean(),cli:z.boolean()}).strict()}).strict();
export type ApplicationSkillDelivery=z.infer<typeof deliverySchema>;
export function applicationSkillDelivery(manifest:ApplicationPackageManifest,allowedOperations:readonly string[],available:{mcp:boolean;cli:boolean}):ApplicationSkillDelivery|undefined{
  if(manifest.schema!=='smartdd-app-package-v2')return undefined;
  const capabilities=manifest.capabilities.filter(c=>allowedOperations.includes(c.permission));
  const selected=capabilities.map(c=>selectCapabilityEntry(c,available).entry);
  return{schema:1,allowedOperations:[...allowedOperations],available:{mcp:selected.includes('mcp'),cli:selected.includes('cli')}};
}
/** Only differing effective invocations get different native identities. Tokens, endpoints and run IDs are absent. */
export function applicationSkillProjectionName(manifest:ApplicationPackageManifest,skillId:string,packageHash:string,delivery?:ApplicationSkillDelivery):string{
  const variant=manifest.schema==='smartdd-app-package-v2'&&manifest.skills.some(s=>s.id===skillId&&s.template)&&manifest.capabilities.some(c=>!!c.binding.cli||!!c.binding.fallback&&'cli'in c.binding.fallback);
  if(!variant)return applicationNativeSkillName(manifest.appId,skillId,packageHash);
  if(!delivery)throw new ApplicationError('INVALID_PACKAGE','动态Skill缺少本次入口参数');
  return applicationNativeSkillName(manifest.appId,skillId,digest(canonicalJson({packageHash,skillId,parameters:applicationSkillParameters(manifest,delivery)})));
}

/** Public delivery parameters only. Invocations always come from verified package bindings. */
export function applicationSkillParameters(manifest:ApplicationPackageManifest,raw:ApplicationSkillDelivery):SkillRenderParameters{
  const parsed=deliverySchema.safeParse(raw);
  if(!parsed.success||manifest.schema!=='smartdd-app-package-v2')throw new ApplicationError('INVALID_PACKAGE','应用模板的交付参数无效');
  const delivery=parsed.data;
  if(new Set(delivery.allowedOperations).size!==delivery.allowedOperations.length||delivery.allowedOperations.some(p=>!manifest.permissions.includes(p)))throw new ApplicationError('SCOPE_DENIED','模板能力超过原包权限');
  return{appId:manifest.appId,entrypoints:applicationCapabilityViews(manifest).filter(c=>delivery.allowedOperations.includes(c.permission)).flatMap(capability=>{
    const choice=selectCapabilityEntry(capability,delivery.available);if(!choice.entry)return[];
    const binding=choice.fallback?capability.binding.fallback!:capability.binding;
    const invocation='mcp'in binding&&binding.mcp?`MCP 工具 ${binding.mcp.tool}`:'cli'in binding&&binding.cli?`willyou-app ${binding.cli.command.join(' ')}`:'';
    return[{capabilityId:capability.id,entry:choice.entry,invocation}];
  })};
}
export function renderApplicationSkill(bytes:Buffer,manifest:ApplicationPackageManifest,skillId:string,delivery:ApplicationSkillDelivery|undefined):Buffer{
  const template=manifest.schema==='smartdd-app-package-v2'&&manifest.skills.find(s=>s.id===skillId)?.template;
  if(!template){if(delivery)throw new ApplicationError('INVALID_PACKAGE','非模板Skill不能携带渲染参数');return bytes;}
  if(!delivery)throw new ApplicationError('INVALID_PACKAGE','模板Skill缺少受信交付参数');
  return renderSkillTemplate(bytes,applicationSkillParameters(manifest,delivery)).bytes;
}

const describeBinding=(binding:ApplicationCapability['binding']|NonNullable<ApplicationCapability['binding']['fallback']>):string=>'mcp'in binding&&binding.mcp?`MCP 工具 ${binding.mcp.tool}`:'cli'in binding&&binding.cli?`willyou-app ${binding.cli.command.join(' ')}`:'';
/** Every declared capability with its primary entry and, for reads, the declared fallback; the host authorizes each call. */
export function libraryEntrypoints(capabilities:readonly ApplicationCapability[]):SkillRenderParameters['entrypoints']{
  return capabilities.map(capability=>{
    const primary=describeBinding(capability.binding),fallback=capability.semantics==='read'&&capability.binding.fallback?describeBinding(capability.binding.fallback):'';
    return{capabilityId:capability.id,entry:capability.binding.cli?'cli':'mcp',invocation:fallback?`${primary}；本会话没有该${capability.binding.cli?'命令':'工具'}时改用 ${fallback}`:primary};
  });
}
const WILLYOU_ONLY='（仅在 WillYou 任务中使用）';
/** Library copies are visible to agents outside WillYou too; the description says where they work. */
export function libraryFrontMatter(input:Buffer,name:string):Buffer{
  const text=input.toString('utf8');if(!Buffer.from(text,'utf8').equals(input))throw new ApplicationError('INVALID_PACKAGE','Skill入口必须为完整UTF-8文本');
  const front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);if(!front)throw new ApplicationError('INVALID_PACKAGE','Skill入口缺少元数据');
  const doc=parseDocument(front[1],{uniqueKeys:true,logLevel:'silent'}),description=doc.get('description');
  if(doc.errors.length||typeof doc.get('name')!=='string'||typeof description!=='string')throw new ApplicationError('INVALID_PACKAGE','Skill元数据无效');
  doc.set('name',name);if(!description.endsWith(WILLYOU_ONLY))doc.set('description',description+WILLYOU_ONLY);
  return Buffer.from('---\n'+doc.toString()+'---\n'+text.slice(front[0].length),'utf8');
}
/** The single library rendering of a package skill: all declared capabilities, no per-run parameters. */
export function renderLibrarySkill(bytes:Buffer,manifest:ApplicationPackageManifest,skillId:string,name:string):Buffer{
  const template=manifest.schema==='smartdd-app-package-v2'&&manifest.skills.find(s=>s.id===skillId)?.template;
  const content=template?renderSkillTemplate(bytes,{appId:manifest.appId,entrypoints:libraryEntrypoints(applicationCapabilityViews(manifest))}).bytes:bytes;
  return libraryFrontMatter(content,name);
}

