import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NativeFileBroker} from './native-broker';
const mock=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:mock.spawn}));
let child:ReturnType<typeof makeChild>,broker:NativeFileBroker;
const input={operation:'save',root:{path:'/private/tmp/source'},recoveryRoot:{path:'/private/tmp/recovery'},base64:'c3ludGhldGlj'};
function makeChild(){const c=Object.assign(new EventEmitter(),{pid:undefined as number|undefined,stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn(()=>{queueMicrotask(()=>c.emit('close',1));return true;})});return c;}
beforeEach(()=>{child=makeChild();mock.spawn.mockReset();mock.spawn.mockReturnValue(child);broker=new NativeFileBroker('/own/native/willyou-files','darwin');});
afterEach(()=>{broker.dispose();vi.restoreAllMocks();});
describe('protected native write process contract (U explicit process faults)',()=>{
 it('rejects a missing sandbox launcher without retrying the unconfined native executable',async()=>{
  const source=JSON.stringify(input),pending=broker.request(input);child.emit('error',Object.assign(new Error('spawn /usr/bin/sandbox-exec ENOENT'),{code:'ENOENT'}));child.emit('close',-1);
  await expect(pending).rejects.toThrow('无法启动受保护的保存进程');expect(mock.spawn).toHaveBeenCalledTimes(1);expect(mock.spawn.mock.calls[0][0]).toBe('/usr/bin/sandbox-exec');expect(mock.spawn.mock.calls[0][2].shell).toBe(false);expect(JSON.stringify(input)).toBe(source);expect(broker.activeProcesses).toBe(0);
 });
 it('preserves an actual native failed receipt instead of retrying outside the policy',async()=>{
  const pending=broker.request(input),receipt={state:'failed',message:'atomic exchange: Operation not permitted',opId:'synthetic-u-only'};child.stdout.write(JSON.stringify({result:receipt})+'\n');child.emit('close',0);
  await expect(pending).resolves.toEqual(receipt);expect(mock.spawn).toHaveBeenCalledTimes(1);expect(broker.activeProcesses).toBe(0);
 });
 it('cancels the protected process through the same owned child lifecycle',async()=>{
  child.pid=4444444;vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('U-only fake child group'),{code:'ESRCH'});});
  const controller=new AbortController(),pending=broker.request(input,{signal:controller.signal});controller.abort();await expect(pending).rejects.toThrow('[CANCELLED]');expect(child.kill).toHaveBeenCalledWith('SIGTERM');expect(mock.spawn).toHaveBeenCalledTimes(1);expect(broker.activeProcesses).toBe(0);
 });
});
