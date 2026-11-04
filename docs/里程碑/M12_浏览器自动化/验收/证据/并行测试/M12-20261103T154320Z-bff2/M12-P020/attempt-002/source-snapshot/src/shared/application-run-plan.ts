import {z} from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(128);
const adapter=z.object({id,version:z.string().min(1).max(128),hash}).strict();
const allowed=z.object({capabilityId:z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/),contractMajor:z.number().int().positive(),appId:id,packageHash:hash,entry:z.enum(['mcp','cli']),mcpTool:z.string().max(256).optional(),cliCommand:z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(2).max(8).optional()}).strict();
export const applicationRunPlanSchema=z.object({
  schema:z.literal('willyou-application-run-plan-v1'),runId:z.uuid(),taskId:id,projectId:id,snapshotHash:hash,
  runner:adapter,capabilityAdapter:adapter,cliVersion:z.string().min(1).max(128),
  grades:z.object({skill:z.boolean(),mcp:z.boolean(),cli:z.boolean(),configuration:z.boolean(),discoveryObserved:z.boolean(),userMessageObserved:z.boolean(),evidence:z.array(z.string().min(1).max(512)).max(32)}).strict(),
  applications:z.array(z.object({appId:id,packageHash:hash,primaryEntry:z.enum(['mcp','cli']),effectiveEntry:z.enum(['mcp','cli','mixed','unavailable']),fallback:z.boolean(),reason:z.string().max(512).nullable()}).strict()).max(32),
  allowed:z.array(allowed).max(8192),
  skills:z.array(z.object({appId:id,skillId:id,nativeName:z.string().max(64),templateHash:hash,parametersHash:hash,renderedHash:hash}).strict()).max(2048),
  sandbox:z.object({source:z.string().min(1).max(128),digest:hash.nullable()}).strict(),createdAt:z.iso.datetime(),planHash:hash,
}).strict().superRefine((plan,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(new Set(plan.applications.map(a=>a.appId)).size!==plan.applications.length||new Set(plan.allowed.map(c=>c.capabilityId)).size!==plan.allowed.length||new Set(plan.skills.map(s=>s.nativeName)).size!==plan.skills.length)fail('运行计划的应用、能力或Skill重复');
  for(const c of plan.allowed){if(!plan.applications.some(a=>a.appId===c.appId&&a.packageHash===c.packageHash)||!c.capabilityId.startsWith(c.appId+'.')||c.entry==='mcp'&&!c.mcpTool||c.entry==='cli'&&!c.cliCommand)fail('运行允许表与应用或入口不一致');}
  if(plan.skills.some(s=>!plan.applications.some(a=>a.appId===s.appId)))fail('运行Skill不属于选用应用');
});
export type ApplicationRunPlan=z.infer<typeof applicationRunPlanSchema>;
export type RunPlanAllowedCapability=ApplicationRunPlan['allowed'][number];
