// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWorkspaceState } from '@shared/browser-workspace';

const h=vi.hoisted(()=>({api:{
  snapshot:vi.fn(),select:vi.fn(),acknowledgePresentation:vi.fn(async()=>undefined),
  profileSiteStates:vi.fn(async()=>[]),placement:vi.fn(async()=>null),overlay:vi.fn(async()=>null),
  accessState:vi.fn(async()=>({requests:[],grants:[]})),focusChrome:vi.fn(async()=>null),
}}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>{}},rpc:{browser:h.api}}));
vi.mock('@renderer/core/agent-tasks-store',()=>({agentTasksStore:{tasks:[]}}));
vi.mock('@renderer/core/navigation',async()=>{
  const {observable}=await import('mobx');
  return{navigation:observable({currentViewId:'agentTask',currentAgentTaskId:'',filePanelOpen:true,agentTaskReadOnly:false})};
});
import { navigation } from '@renderer/core/navigation';
import { panelsFor } from '@renderer/features/agent-tasks/workspace-panels-store';
import { browserWorkspaceFor, showBrowserPresentation } from './store';
import { AgentBrowserSurface } from './workspace';
import { authorizeBrowserPresentation, observeBrowserPresentationView, rememberBrowserPresentation } from './open-presentation';

const panelHost=observer(({taskId}:{taskId:string})=>{
  const panels=panelsFor({kind:'task',taskId});
  return panels.tabs.includes('browser')?<AgentBrowserSurface taskId={taskId} workspaceHeader={{target:null,active:panels.active==='browser',onActivate:()=>panels.open('browser'),onClose:()=>panels.close('browser'),onAutoClose:()=>panels.close('browser',true)}}/>:null;
});
const PanelHost=panelHost;
const state=(taskId:string,id:string|null):BrowserWorkspaceState=>({taskId,projectId:'fixture-project',activeId:id,recent:[],notice:null,external:null,find:{active:0,total:0},tabs:id?[{id,url:'https://fixture.example.test/'+id,title:id,profileId:'project-fixture',favicon:null,loading:false,canGoBack:false,canGoForward:false,failure:null,certificate:null}]:[]});
let stop:()=>void;let previousVisibility:PropertyDescriptor|undefined;
beforeEach(()=>{
  vi.clearAllMocks();localStorage.clear();
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,width:800,height:600,top:0,left:0,right:800,bottom:600,toJSON(){return {};}});
  previousVisibility=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'checkVisibility');
  Object.defineProperty(HTMLElement.prototype,'checkVisibility',{configurable:true,value:function(this:HTMLElement){return this.isConnected&&!this.closest('[hidden]');}});
  stop=observeBrowserPresentationView();
});
afterEach(()=>{cleanup();stop();vi.restoreAllMocks();vi.unstubAllGlobals();if(previousVisibility)Object.defineProperty(HTMLElement.prototype,'checkVisibility',previousVisibility);else Reflect.deleteProperty(HTMLElement.prototype,'checkVisibility');});

it.each(['before-select','during-select','manual-choice'] as const)('M16 B06 preserves or revokes the real presentation intent through %s',async phase=>{
  const taskId='fixture-'+phase,event={taskId,pageId:'new-page',clientInputId:'input-'+phase,operationId:'operation-'+phase};
  runInAction(()=>{navigation.currentViewId='agentTask';navigation.currentAgentTaskId=taskId;});
  const panels=panelsFor({kind:'task',taskId}),store=browserWorkspaceFor(taskId);
  let actual=state(taskId,'old-page');h.api.snapshot.mockImplementation(async()=>actual);
  let release!:()=>void;h.api.select.mockImplementation(()=>new Promise<void>(resolve=>{release=()=>{actual=state(taskId,'new-page');resolve();};}));
  panels.open('browser');render(<PanelHost taskId={taskId}/>);
  await waitFor(()=>expect(document.querySelector(`[data-browser-task="${taskId}"][data-browser-page="old-page"]`)).not.toBeNull());
  rememberBrowserPresentation(taskId,event.clientInputId);
  async function oldEmptySnapshot(){actual=state(taskId,null);await act(async()=>{await store.refresh();});}
  if(phase==='before-select'){
    await oldEmptySnapshot();expect(panels.tabs).not.toContain('browser');expect(authorizeBrowserPresentation(event)).toBe(true);
  }
  let pending!:Promise<void>;act(()=>{pending=showBrowserPresentation(event);});
  expect(h.api.select).toHaveBeenCalledWith({taskId,tabId:'new-page',automated:true});
  if(phase==='during-select'){
    await oldEmptySnapshot();expect(authorizeBrowserPresentation(event)).toBe(true);
  }
  if(phase==='manual-choice')act(()=>panels.open('files'));
  await act(async()=>{release();await Promise.resolve();});
  if(phase!=='manual-choice')await waitFor(()=>expect(document.querySelector(`[data-browser-task="${taskId}"][data-browser-page="new-page"]`)).not.toBeNull());
  await pending;
  expect(h.api.acknowledgePresentation).toHaveBeenCalledWith({...event,shown:phase!=='manual-choice'});
  expect(panels.active).toBe(phase==='manual-choice'?'files':'browser');
});
