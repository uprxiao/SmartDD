import {z} from 'zod';
import {terminalTargetSchema} from './file-terminal';
import {applicationIdSchema} from './application-connections';
import {zentaoSourceRefSchema} from './application-zentao';
import {mailSourceRefSchema} from './application-mail-data';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const applicationTerminalSourceSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('skill'),appId:applicationIdSchema,skillId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)}).strict(),
 z.object({kind:z.literal('zentao'),objectKind:z.enum(['bug','story']),reference:zentaoSourceRefSchema}).strict(),
 z.object({kind:z.literal('mail'),reference:mailSourceRefSchema}).strict(),
 z.object({kind:z.literal('draft'),draftId:z.uuid(),revision:z.number().int().positive(),contentHash:hash}).strict(),
]);
export type ApplicationTerminalSource=z.infer<typeof applicationTerminalSourceSchema>;
export const applicationTerminalBindSchema=z.object({target:terminalTargetSchema,projectId:z.string().min(1).max(128),source:applicationTerminalSourceSchema}).strict();
export type ApplicationTerminalBind=z.infer<typeof applicationTerminalBindSchema>;
export const applicationTerminalInsertSchema=z.object({bindingId:z.uuid(),operationId:z.uuid()}).strict();
export type ApplicationTerminalInsert=z.infer<typeof applicationTerminalInsertSchema>;
export interface ApplicationTerminalBinding {id:string;taskId:string;ptyId:string;projectId:string;runId:string;text:string;expiresAt:number}
/** Text approved in the shared prototype. No model instruction or external action is submitted here. */
export const APPLICATION_SKILL_EXAMPLES:Readonly<Record<string,string>>=Object.freeze({
 'zentao:bug-analysis':'查看指派给我的 Bug，结合当前项目代码分析根因，先给出处理建议。',
 'zentao:story-review':'查看指派给我的研发需求，检查描述和验收标准，整理需要补充的问题。',
 'mail:work-assistant':'找出今天与当前项目有关的本地邮件，总结待办事项，并准备需要回复的草稿。',
});
export function terminalSourceApp(source:ApplicationTerminalSource){return source.kind==='skill'?source.appId:source.kind==='zentao'?'zentao' as const:'mail' as const;}
export function applicationReferenceText(source:ApplicationTerminalSource):string{
 if(source.kind==='skill'){const text=APPLICATION_SKILL_EXAMPLES[source.appId+':'+source.skillId];if(!text)throw new Error('没有已确认的Skill示例');return text;}
 if(source.kind==='draft')return `[邮件草稿 mail-draft://${source.draftId}?revision=${source.revision}&contentHash=${source.contentHash}] 请读取此草稿并继续处理。`;
 const r=source.reference,uri=source.kind==='mail'?`mail://${r.connectionId}/${r.nativeId}`:`zentao://${r.connectionId}/${source.objectKind}/${r.nativeId}`;
 return `[${source.kind==='mail'?'邮件':source.objectKind==='bug'?'禅道 Bug':'禅道 Story'} ${uri}] 原来源引用 ${JSON.stringify(r)} ${source.kind==='mail'?'请基于这封邮件继续分析。':'请读取详情并分析。'}`;
}
