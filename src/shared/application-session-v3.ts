import {z} from 'zod';
import {capabilitySessionSnapshotSchema,applicationNativeSkillName} from './application-session';
const fields=capabilitySessionSnapshotSchema.shape;
/** Transport-independent snapshots. The schema-2 parser remains intact for historical sessions. */
export const capabilitySessionSnapshotV3Schema=z.object({
  ...fields,schema:z.literal(3),
  packages:z.array(fields.packages.element.extend({
    entry:z.enum(['mcp','cli']),
    capabilityContractMajors:z.record(z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),z.number().int().positive()),
  }).strict()).max(32),
}).strict().superRefine((snapshot,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(Object.keys(snapshot.adapterBinding.nativeToolNames).length>512||new Set(Object.values(snapshot.adapterBinding.nativeToolNames)).size!==Object.keys(snapshot.adapterBinding.nativeToolNames).length)fail('原生工具映射重复或超过预算');
  if(snapshot.adapterBinding.id!==snapshot.runner||snapshot.legacyBinding||snapshot.provenance!=='created'||snapshot.adapterBinding.projectionFormatVersion!==1)fail('新快照不能冒充旧格式迁移');
  if(new Set(snapshot.packages.map(p=>p.appId)).size!==snapshot.packages.length||new Set(snapshot.standardSkills.map(s=>s.skillId)).size!==snapshot.standardSkills.length)fail('快照应用或标准Skill重复');
  const skills=snapshot.packages.flatMap(p=>p.skills),paths=[...skills.map(s=>s.projectionPath),...snapshot.standardSkills.map(s=>s.projectionPath)];
  if(new Set(paths).size!==paths.length||new Set(skills.map(s=>s.nativeName)).size!==skills.length)fail('Skill名称或投影路径重复');
  if(new Set(snapshot.mcp.map(m=>m.serverName)).size!==snapshot.mcp.length||new Set(snapshot.mcp.map(m=>m.kind)).size!==snapshot.mcp.length)fail('MCP名称或桥类别重复');
  const requiringMcp=snapshot.packages.filter(p=>Object.keys(p.toolContractMajors).length>0),bridge=snapshot.mcp.find(m=>m.kind==='applications');
  if(requiringMcp.length&&(!bridge||requiringMcp.some(p=>p.runtimeHash!==bridge.runtimeHash)))fail('MCP能力须有对应的固定业务桥');
  if(!requiringMcp.length&&bridge)fail('纯CLI应用不能自动增加MCP桥');
  for(const p of snapshot.packages){
    if(new Set(p.skills.map(s=>s.skillId)).size!==p.skills.length||new Set(p.allowedOperations).size!==p.allowedOperations.length||p.hostApi.min>p.hostApi.max)fail('应用Skill、动作或宿主范围无效');
    if(Object.keys(p.capabilityContractMajors).length>256||Object.keys(p.capabilityContractMajors).some(id=>!id.startsWith(p.appId+'.')))fail('能力标识不属于本应用');
    for(const s of p.skills)if(s.nativeName!==applicationNativeSkillName(p.appId,s.skillId,p.packageHash))fail('Skill名称未固定到原包');
  }
});
export type CapabilitySessionSnapshotV3=z.infer<typeof capabilitySessionSnapshotV3Schema>;
export const storedCapabilitySessionSnapshotSchema=z.discriminatedUnion('schema',[capabilitySessionSnapshotSchema,capabilitySessionSnapshotV3Schema]);
