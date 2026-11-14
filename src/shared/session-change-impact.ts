import {z} from 'zod';
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const builtinIds=new Set(['smartdd-project-context','smartdd-project-db-diagnostics','smartdd-remote-password-ssh','willyou-project-db-diagnostics','willyou-remote-password-ssh']);
export const sessionChangeQuerySchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('plugin'),appId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),projectId:id.optional()}).strict(),
 z.object({kind:z.literal('capability'),ids:z.array(id).min(1).max(2048),management:z.boolean().default(false)}).strict(),
 z.object({kind:z.literal('builtin'),id:id.refine(value=>builtinIds.has(value),'未知的内置能力')}).strict(),
]);
export type SessionChangeQuery=z.infer<typeof sessionChangeQuerySchema>;
/** Read-only, as-of-click explanation. Never a permission, stop or write authority. */
export interface SessionChangeImpact {runningCount:number;globalDisabled:boolean;checkedAt:string}
