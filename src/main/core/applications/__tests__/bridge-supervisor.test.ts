import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeSupervisor, type RecoveryAttempt } from '../bridge-supervisor';
afterEach(() => vi.useRealTimers());
describe('host bridge recovery coordination', () => {
  it('never attempts an unverified native reload', async () => {
    const supervisor = new BridgeSupervisor(), replace = vi.fn();
    supervisor.register('run', 'mail', { capability: 'unverified', validate: async () => {}, replace });
    expect(await supervisor.prepareReplacement('run', 'mail', 0)).toMatchObject({ code: 'RECOVERY_UNSUPPORTED', attempts: 0 });
    expect(replace).not.toHaveBeenCalled();
  });
  it('shares concurrent ownership and never resets exhausted attempts', async () => {
    vi.useFakeTimers();
    const supervisor = new BridgeSupervisor(() => 0), instances: string[] = [];
    supervisor.register('run', 'mail', { capability: 'supported', evidence: 'controlled adapter fixture', validate: async () => {}, replace: async attempt => { instances.push(attempt.instanceId); return false; } });
    const first = supervisor.prepareReplacement('run', 'mail', 0);
    expect(supervisor.prepareReplacement('run', 'mail', 0)).toBe(first);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await first).toMatchObject({ code: 'RECOVERY_EXHAUSTED', attempts: 3, generation: 3 });
    expect(new Set(instances).size).toBe(3);
    await supervisor.prepareReplacement('run', 'mail', 3);
    expect(instances).toHaveLength(3);
    expect(supervisor.beginRecovery('run', 'mail', 3, 'disconnected')).toBe(false);
    expect(supervisor.beginRecovery('run', 'mail', 3, 'user-retry')).toBe(true);
    expect((await supervisor.prepareReplacement('run', 'mail', 3)).code).toBe('STALE_GENERATION');
  });
  it('rejects a late successful handshake after revocation', async () => {
    const supervisor = new BridgeSupervisor(); let finish!: (value: boolean) => void;
    const replace = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    supervisor.register('run', 'mail', { capability: 'supported', evidence: 'fixture', validate: async () => {}, replace });
    const pending = supervisor.prepareReplacement('run', 'mail', 0);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
    supervisor.revoke('run', 'mail');
    expect((await pending).code).toBe('RECOVERY_REVOKED');
    finish(true); await Promise.resolve(); await Promise.resolve();
    expect(supervisor.inspect('run', 'mail')?.result?.code).toBe('RECOVERY_REVOKED');
  });
  it('bounds a hanging adapter and aborts only this service', async () => {
    vi.useFakeTimers(); const supervisor = new BridgeSupervisor(); let attempt!: RecoveryAttempt;
    supervisor.register('run', 'mail', { capability: 'supported', evidence: 'fixture', validate: async () => {}, replace: async value => { attempt = value; return new Promise(() => {}); } });
    supervisor.register('run', 'zentao', { capability: 'unverified', validate: async () => {} });
    const pending = supervisor.prepareReplacement('run', 'mail', 0, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).code).toBe('RECOVERY_EXHAUSTED');
    expect(attempt.signal.aborted).toBe(true);
    expect(supervisor.beginRecovery('run', 'mail', 1, 'user-retry')).toBe(false);
    expect(supervisor.inspect('run', 'zentao')).toMatchObject({ attempts: 0, revoked: false });
  });
  it('uses bounded backoff and cancels before issuing the next replacement', async () => {
    vi.useFakeTimers(); const supervisor = new BridgeSupervisor(() => 0), replace = vi.fn(async () => false);
    supervisor.register('run', 'mail', { capability: 'supported', evidence: 'fixture', validate: async () => {}, replace });
    const pending = supervisor.prepareReplacement('run', 'mail', 0);
    await vi.advanceTimersByTimeAsync(999);
    expect(replace).toHaveBeenCalledTimes(1);
    supervisor.revoke('run', 'mail');
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).code).toBe('RECOVERY_REVOKED');
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it('starts a new fault episode only after verified success and keeps generations monotonic', async () => {
    const supervisor = new BridgeSupervisor(), replace = vi.fn(async () => true);
    supervisor.register('run', 'mail', { capability: 'supported', evidence: 'fixture', validate: async () => {}, replace });
    expect((await supervisor.prepareReplacement('run', 'mail', 0)).code).toBe('CONNECTED');
    expect(supervisor.beginRecovery('run', 'mail', 0, 'disconnected')).toBe(false);
    expect(supervisor.beginRecovery('run', 'mail', 1, 'disconnected')).toBe(true);
    expect(await supervisor.prepareReplacement('run', 'mail', 2)).toMatchObject({ code: 'CONNECTED', attempts: 1, generation: 3 });
    expect(replace).toHaveBeenCalledTimes(2);
  });
  it('rejects wrong instance and old generation reports during a new attempt',async()=>{
    const supervisor=new BridgeSupervisor();let current!:RecoveryAttempt;let finish!:(value:boolean)=>void;
    supervisor.register('run','mail',{capability:'supported',evidence:'fixture',validate:async()=>{},replace:async attempt=>{current=attempt;return new Promise<boolean>(resolve=>{finish=resolve;});}});
    const pending=supervisor.prepareReplacement('run','mail',0);
    await vi.waitFor(()=>expect(current).toBeDefined());
    expect(supervisor.reportAttempt('run','mail','old-instance',current.generation,true)).toBe(false);
    expect(supervisor.reportAttempt('run','mail',current.instanceId,current.generation-1,true)).toBe(false);
    expect(supervisor.reportAttempt('run','mail',current.instanceId,current.generation,true)).toBe(true);
    expect(supervisor.reportAttempt('run','mail',current.instanceId,current.generation,false)).toBe(false);
    finish(true);expect((await pending).code).toBe('CONNECTED');
    expect(supervisor.reportAttempt('run','mail',current.instanceId,current.generation,true)).toBe(false);
  });
  it('rechecks current authorization after handshake and rejects stale generations', async () => {
    const supervisor = new BridgeSupervisor(); let authorized = true;
    supervisor.register('run', 'mail', { capability: 'supported', evidence: 'fixture', validate: async () => { if (!authorized) throw Error('revoked'); }, replace: async () => { authorized = false; return true; } });
    expect((await supervisor.prepareReplacement('run', 'mail', 1)).code).toBe('STALE_GENERATION');
    expect((await supervisor.prepareReplacement('run', 'mail', 0)).code).toBe('RECOVERY_REVOKED');
  });
});
