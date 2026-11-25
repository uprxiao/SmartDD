// @vitest-environment jsdom
import { expect,it,vi,beforeEach } from 'vitest';
const fixture=vi.hoisted(()=>({listeners:[] as Array<(event:any)=>void>,list:vi.fn(async()=>[])}));
vi.mock('@renderer/lib/ipc',()=>({
  rpc:{agentTasks:{list:fixture.list}},events:{on:(_name:unknown,listener:(event:any)=>void)=>{fixture.listeners.push(listener);return ()=>{};}},
}));
import { agentTasksStore,setRequestNotify } from './agent-tasks-store';
import { navigation } from './navigation';
it('F16 E09 existing pending request notification and actual task navigation, renderer adapter only',async()=>{
  const sent:Array<{title:string;body:string;onclick:null|(()=>void)}>=[];
  class FixtureNotification {
    readonly title:string;
    readonly body:string;
    onclick:null|(()=>void)=null;
    constructor(title:string,options:{body:string}){this.title=title;this.body=options.body;sent.push(this);}
  }
  const focus=vi.spyOn(window,'focus').mockImplementation(()=>{});
  const hasFocus=vi.spyOn(document,'hasFocus').mockReturnValue(false);
  vi.stubGlobal('Notification',FixtureNotification);
  setRequestNotify(true);
  agentTasksStore.start();await agentTasksStore.refresh();
  const emit=(event:any)=>fixture.listeners.forEach(l=>l(event));
  emit({type:'request.opened',taskId:'scheduled-fixture-task',payload:{requestId:'fixture-approval'}});
  expect(sent).toHaveLength(1);
  expect(sent[0].title).toBe('WillYou · 等待你处理');
  sent[0].onclick?.();
  expect(focus).toHaveBeenCalledOnce();
  expect(navigation.currentAgentTaskId).toBe('scheduled-fixture-task');
  expect(navigation.currentViewId).toBe('agentTask');
  hasFocus.mockReturnValue(true);
  emit({type:'request.opened',taskId:'foreground-fixture'});
  expect(sent).toHaveLength(1);
  hasFocus.mockReturnValue(false);setRequestNotify(false);
  emit({type:'request.opened',taskId:'disabled-fixture'});
  expect(sent).toHaveLength(1);
  setRequestNotify(true);
  emit({type:'turn.ended',taskId:'scheduled-fixture-task',payload:{status:'failed'}});
  expect(sent).toHaveLength(1);
  console.log(JSON.stringify({case:'E09-notification',backgroundRequest:true,foregroundSuppressed:true,settingSuppressed:true,deepLink: navigation.currentAgentTaskId,
    ordinaryTurnFailedNotification:false,layer:'actual agent-tasks-store + navigation; synthetic renderer notification adapter, not OS permission or system delivery'}));
  vi.unstubAllGlobals();focus.mockRestore();hasFocus.mockRestore();
});
