import {runInAction} from 'mobx';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {navigation} from '@renderer/core/navigation';
import {
  authorizeBrowserPresentation,browserViewRevision,enterBrowserPresentationTask,
  invalidateBrowserPresentation,observeBrowserPresentationView,rememberBrowserPresentation,
} from './open-presentation';

vi.mock('@renderer/core/navigation',async()=>{
  const {observable}=await import('mobx');
  return{navigation:observable({currentViewId:'agentTask',currentAgentTaskId:'task',agentTaskReadOnly:false,filePanelOpen:true})};
});

let stop:()=>void;
beforeEach(()=>{
  runInAction(()=>{navigation.currentViewId='agentTask';navigation.currentAgentTaskId='task';});
  stop=observeBrowserPresentationView();
});
afterEach(()=>stop());
const event=(clientInputId:string)=>({clientInputId,taskId:'task',pageId:'page',operationId:'operation'});

it('accepts the original send and rejects a presentation after switching away and back',()=>{
  rememberBrowserPresentation('task','first');
  expect(authorizeBrowserPresentation(event('first'))).toBe(true);
  runInAction(()=>{navigation.currentAgentTaskId='other';});
  runInAction(()=>{navigation.currentAgentTaskId='task';});
  expect(authorizeBrowserPresentation(event('first'))).toBe(false);
});

it('does not give a retried send a new presentation revision after a panel change',()=>{
  rememberBrowserPresentation('task','retry');
  invalidateBrowserPresentation();
  rememberBrowserPresentation('task','retry');
  expect(authorizeBrowserPresentation(event('retry'))).toBe(false);
});

it('transfers the home send to its automatic task transition',()=>{
  runInAction(()=>{navigation.currentViewId='home';});
  const revision=browserViewRevision();
  rememberBrowserPresentation('task','home',revision,true);
  expect(authorizeBrowserPresentation(event('home'))).toBe(false);
  const deferred=enterBrowserPresentationTask('task','home',()=>{
    runInAction(()=>{navigation.currentViewId='agentTask';});
  });
  expect(deferred).toEqual(event('home'));
  expect(authorizeBrowserPresentation(deferred!)).toBe(true);
});
