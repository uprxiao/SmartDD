import {z} from 'zod';

export const browserProfileSchema=z.object({
  id:z.string().min(1),scope:z.enum(['project','isolated','imported']),partition:z.string().min(1),label:z.string().trim().min(1).max(120),
  owner:z.object({kind:z.enum(['project','task']),id:z.string().min(1)}).strict(),
  source:z.object({family:z.enum(['chrome','edge']),profile:z.string().min(1),importedAt:z.number().finite()}).strict().nullable(),
}).strict().superRefine((profile,context)=>{
  if(profile.partition!=='persist:wy-browser-'+profile.id||profile.scope==='project'&&profile.owner.kind!=='project'||profile.scope!=='project'&&profile.owner.kind!=='task')context.addIssue({code:'custom',message:'登录态分区或归属无效'});
});
export const browserProfilesSchema=z.object({schemaVersion:z.literal(1),profiles:z.array(browserProfileSchema)}).strict().superRefine((value,context)=>{
  if(new Set(value.profiles.map(profile=>profile.id)).size!==value.profiles.length||new Set(value.profiles.filter(profile=>profile.scope==='project').map(profile=>profile.owner.id)).size!==value.profiles.filter(profile=>profile.scope==='project').length)context.addIssue({code:'custom',message:'登录态身份重复'});
});
export type BrowserProfile=z.infer<typeof browserProfileSchema>;
export interface BrowserProfileCaller {projectId:string;taskId:string}
