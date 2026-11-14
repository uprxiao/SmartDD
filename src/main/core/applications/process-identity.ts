import { execFileSync } from 'node:child_process';
import { z } from 'zod';
export interface ProcessIdentity { pid: number;startedAt: string }
export interface NativeSqliteFile { path:string;dev:string;ino:string }
export interface OwnedNativeProcess extends ProcessIdentity { root:ProcessIdentity;executable:string }
export type ProcessState = 'running' | 'stopped' | 'unknown';
export interface ProcessIdentityReader {
  read(pid: number): ProcessIdentity | null;
  state(identity: ProcessIdentity): ProcessState;
  /** Only descend from an exact host-owned launch; ambiguous targets grant nothing. */
  nativeChild?(root:ProcessIdentity,executable:string):OwnedNativeProcess|null;
  sqliteFiles?(identity:ProcessIdentity,executable:string):NativeSqliteFile[]|null;
}
const response = z.discriminatedUnion('state',[
  z.object({ schema: z.literal(1),state: z.literal('running'),pid: z.number().int().positive().max(2147483647),startedAt: z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/) }).strict(),
  z.object({ schema: z.literal(1),state: z.enum(['stopped','unknown']) }).strict(),
]);
const birthSchema=z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/);
const pidSchema=z.number().int().positive().max(2147483647);
const pathSchema=z.string().startsWith('/').max(4096).regex(/^[^\x00\r\n]+$/);
const sqliteResponse=z.object({schema:z.literal(3),state:z.literal('running'),pid:pidSchema,startedAt:birthSchema,executable:pathSchema,files:z.array(z.object({path:pathSchema,dev:z.string().regex(/^[0-9]{1,24}$/),ino:z.string().regex(/^[0-9]{1,24}$/)}).strict()).max(256)}).strict();
const childResponse=z.object({schema:z.literal(4),state:z.literal('running'),rootPid:pidSchema,rootStartedAt:birthSchema,pid:pidSchema,startedAt:birthSchema,executable:pathSchema}).strict();
/** Only probes a PID obtained from our own launch/lease record; never enumerates processes. */
export class MacProcessIdentityReader implements ProcessIdentityReader {
  constructor(private readonly helper: string) {}
  private inspect(pid: number): z.infer<typeof response> {
    if (process.platform !== 'darwin' || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) return { schema: 1,state: 'unknown' };
    try { return response.parse(JSON.parse(execFileSync(this.helper,[String(pid)],{ timeout: 2000,maxBuffer: 4096,encoding: 'utf8',windowsHide: true,stdio: ['ignore','pipe','ignore'] }))); }
    catch { return { schema: 1,state: 'unknown' }; }
  }
  read(pid: number): ProcessIdentity | null { const result = this.inspect(pid); return result.state === 'running' && result.pid === pid ? { pid: result.pid,startedAt: result.startedAt } : null; }
  state(identity: ProcessIdentity): ProcessState {
    if (!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(identity.startedAt)) return 'unknown';
    const result = this.inspect(identity.pid);
    if (result.state !== 'running') return result.state;
    return result.pid === identity.pid && result.startedAt === identity.startedAt ? 'running' : 'stopped';
  }
  private metadata(mode:string,identity:ProcessIdentity,executable:string):unknown {
    if(process.platform!=='darwin'||!pidSchema.safeParse(identity.pid).success||!birthSchema.safeParse(identity.startedAt).success||!pathSchema.safeParse(executable).success)return null;
    try{return JSON.parse(execFileSync(this.helper,[mode,String(identity.pid),identity.startedAt,executable],{timeout:2000,maxBuffer:1024*1024,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}));}catch{return null;}
  }
  nativeChild(root:ProcessIdentity,executable:string):OwnedNativeProcess|null {
    const parsed=childResponse.safeParse(this.metadata('--owned-native-child',root,executable));
    if(!parsed.success||parsed.data.rootPid!==root.pid||parsed.data.rootStartedAt!==root.startedAt||parsed.data.executable!==executable)return null;
    return {root:{...root},pid:parsed.data.pid,startedAt:parsed.data.startedAt,executable};
  }
  sqliteFiles(identity:ProcessIdentity,executable:string):NativeSqliteFile[]|null {
    const parsed=sqliteResponse.safeParse(this.metadata('--sqlite-files',identity,executable));
    if(!parsed.success||parsed.data.pid!==identity.pid||parsed.data.startedAt!==identity.startedAt||parsed.data.executable!==executable)return null;
    return parsed.data.files;
  }
}
