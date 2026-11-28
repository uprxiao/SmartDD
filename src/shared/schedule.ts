import {z} from 'zod';
const hhmm=z.string().regex(/^\d{2}:\d{2}$/);
const calendar={zone:z.string().max(128).default(''),time:hhmm};
export const scheduleSchema=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('interval'),minutes:z.number().int().positive(),anchor:z.number().int().optional(),zone:z.string().max(128).default('')}),
  z.strictObject({type:z.literal('daily'),...calendar}),z.strictObject({type:z.literal('workdays'),...calendar}),
  z.strictObject({type:z.literal('weekly'),...calendar,days:z.array(z.number().int().min(0).max(6)).min(1).max(7)}),
  z.strictObject({type:z.literal('monthly'),...calendar,monthDay:z.union([z.literal('last'),z.number().int().min(1).max(31)] )}),
  z.strictObject({type:z.literal('once'),...calendar,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),onceAt:z.number().int().optional()}),
  z.strictObject({type:z.literal('cron'),zone:z.string().max(128).default(''),cron:z.string().trim().min(1).max(256)})
]);
export type Schedule=z.output<typeof scheduleSchema>;
export const scheduleConfigSchema=z.strictObject({
  title:z.string().trim().min(1).max(120),prompt:z.string().refine(v=>!!v.trim(),'提示词不能为空').max(240000),
  projectId:z.string().min(1).nullable(),dirId:z.string().min(1).nullable(),cwd:z.string().min(1).refine(v=>!!v.trim()).nullable(),
  workspace:z.enum(['directory','plan-worktree','run-worktree']),baseRef:z.string().max(256).nullable(),
  destination:z.enum(['new','reuse','existing']),boundTask:z.string().min(1).nullable(),
  profileId:z.string().min(1),model:z.string().max(256).optional(),effort:z.string().max(24).optional(),
  tier:z.enum(['ask','auto','full']),delegation:z.boolean(),notifyCompleted:z.boolean(),
  compatibility:z.string().max(512).optional()
}).superRefine((v,ctx)=>{
  if(v.projectId&&!v.dirId&&v.destination!=='existing'||!v.projectId&&v.dirId)ctx.addIssue({code:'custom',message:'项目与目录不匹配',path:['dirId']});
  if(v.workspace!=='directory'&&(!v.projectId||!v.baseRef))ctx.addIssue({code:'custom',message:'工作树需要 Git 项目及基准引用',path:['workspace']});
  if(v.destination==='existing'&&v.workspace!=='directory')ctx.addIssue({code:'custom',message:'指定任务须沿用原工作目录',path:['workspace']});
  if(v.workspace==='run-worktree'&&v.destination!=='new')ctx.addIssue({code:'custom',message:'每次新建工作树必须使用新任务',path:['destination']});
  if(v.destination==='existing'&&!v.boundTask)ctx.addIssue({code:'custom',message:'请选择指定任务',path:['boundTask']});
});
export type ScheduleConfig=z.output<typeof scheduleConfigSchema>;
export const scheduleSaveSchema=z.strictObject({id:z.string().optional(),revision:z.number().int().positive().optional(),schedule:scheduleSchema,config:scheduleConfigSchema,grace:z.union([z.literal(0),z.literal(10),z.literal(60),z.literal(720)]),enabled:z.boolean()});
export type ScheduleSave=z.input<typeof scheduleSaveSchema>;
export type SchedulePlan={id:string;revision:number;schedule:Schedule;config:ScheduleConfig;grace:number;enabled:boolean;archived:boolean;ended:boolean;nextDue:number|null;zone:string;boundTask:string|null;repair:string|null;createdAt:number;updatedAt:number};
export type ScheduleRunState='claimed'|'preparing'|'dispatching'|'running'|'waiting'|'unknown'|'completed'|'failed'|'skipped'|'stopped';
export type ScheduleRun={id:string;planId:string;revision:number;occurrenceKey:string;trigger:'manual'|'scheduled';due:number;claimedAt:number;missedFrom:number|null;status:ScheduleRunState;attempts:number;taskId:string|null;inputId:string;snapshot:{schedule:Schedule;config:ScheduleConfig;grace:number};turnId:string|null;reason:string|null;startedAt:number|null;finishedAt:number|null;workspaceId:string|null;actualConfig:ScheduleActualConfig|null};
export type ScheduleClaim={kind:'claimed'|'skipped'|'duplicate';run:ScheduleRun}|{kind:'busy'|'unavailable'|'stale'|'not_due'|'repair';reason?:string};

export type ScheduleActualConfig={cwd:string;projectId:string|null;dirId:string|null;profileId:string;driverId:string;profileName?:string;providerName?:string;providerId?:string;model?:string;effort?:string;tier:string;delegation:boolean};

/** New-plan defaults are shared with host validation and persisted unchanged. */
export const newScheduleConfig=():ScheduleConfig=>({title:'',prompt:'',projectId:null,dirId:null,cwd:null,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'',tier:'ask',delegation:false,notifyCompleted:false});
export const newSchedule=():Schedule=>({type:'workdays',zone:'',time:'09:00'});
export const defaultScheduleGrace=60 as const;
