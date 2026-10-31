import { execFileSync } from 'node:child_process';
import { z } from 'zod';
export interface ProcessIdentity { pid: number;startedAt: string }
export type ProcessState = 'running' | 'stopped' | 'unknown';
export interface ProcessIdentityReader {
  read(pid: number): ProcessIdentity | null;
  state(identity: ProcessIdentity): ProcessState;
}
const response = z.discriminatedUnion('state',[
  z.object({ schema: z.literal(1),state: z.literal('running'),pid: z.number().int().positive().max(2147483647),startedAt: z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/) }).strict(),
  z.object({ schema: z.literal(1),state: z.enum(['stopped','unknown']) }).strict(),
]);
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
}
