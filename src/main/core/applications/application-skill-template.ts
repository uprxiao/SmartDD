import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {applicationCapabilityViews,type ApplicationPackageManifest} from '@shared/application-capabilities';
import {renderSkillTemplate,selectCapabilityEntry,type SkillRenderParameters} from './run-plan';

const deliverySchema=z.object({schema:z.literal(1),allowedOperations:z.array(z.string()).max(256),available:z.object({mcp:z.boolean(),cli:z.boolean()}).strict()}).strict();
export type ApplicationSkillDelivery=z.infer<typeof deliverySchema>;

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
