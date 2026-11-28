// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({
  opened:null as null|((event:{type:string;taskId:string;scheduled?:boolean})=>void),
  list:vi.fn(async()=>[]),notify:vi.fn(async()=>undefined),
  openTask:vi.fn(),notification:vi.fn(),
}));
vi.mock('@renderer/lib/ipc',()=>({
  events:{on:(_event:unknown,handler:NonNullable<typeof fixture.opened>)=>{fixture.opened=handler;return ()=>{};}},
  rpc:{agentTasks:{list:fixture.list},schedule:{setNotifyEnabled:fixture.notify}},
}));
vi.mock('@renderer/core/navigation',()=>({navigation:{currentViewId:'home',openAgentTask:fixture.openTask}}));
import { agentTasksStore, setRequestNotify } from './agent-tasks-store';

afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

it('M16 A50 keeps the original ordinary background notification and suppresses its duplicate for scheduled requests',async()=>{
  vi.useFakeTimers();localStorage.clear();
  vi.spyOn(document,'hasFocus').mockReturnValue(false);
  vi.stubGlobal('Notification',class {onclick?:()=>void;constructor(title:string,options?:NotificationOptions){fixture.notification(title,options);}});
  agentTasksStore.start();await Promise.resolve();expect(fixture.notify).toHaveBeenCalledWith(true);
  expect(fixture.opened).toBeTypeOf('function');
  fixture.opened!({type:'request.opened',taskId:'scheduled-task',scheduled:true});
  fixture.opened!({type:'request.opened',taskId:'scheduled-task',scheduled:true});
  expect(fixture.notification).not.toHaveBeenCalled();
  fixture.opened!({type:'request.opened',taskId:'ordinary-task'});
  expect(fixture.notification).toHaveBeenCalledTimes(1);
  setRequestNotify(false);expect(fixture.notify).toHaveBeenLastCalledWith(false);
  fixture.opened!({type:'request.opened',taskId:'ordinary-task'});
  expect(fixture.notification).toHaveBeenCalledTimes(1);
  setRequestNotify(true);vi.mocked(document.hasFocus).mockReturnValue(true);
  fixture.opened!({type:'request.opened',taskId:'ordinary-task'});
  expect(fixture.notification).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(150);
});
