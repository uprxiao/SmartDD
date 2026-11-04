import type {IpcMainInvokeEvent} from 'electron';
import {z} from 'zod';
import {createScopedRPCController} from '@shared/ipc/rpc';
import {browserTaskInput,browserTabInput,browserNavigationInput,browserActionInput,browserPlacementInput} from '@shared/browser-workspace';
import type {BrowserService} from './service';
import {BrowserError} from './errors';
import {browserSettingsSchema} from '@shared/browser-settings';
export function createBrowserController(service:BrowserService|undefined,trusted:(event:IpcMainInvokeEvent)=>boolean){
  const host=(event:IpcMainInvokeEvent)=>{
    if(!event?.sender||event.sender.isDestroyed()||event.senderFrame!==event.sender.mainFrame||!trusted(event))throw new BrowserError('BROWSER_UNAVAILABLE','浏览器界面操作只允许可信主窗口');
    if(!service)throw new BrowserError('BROWSER_UNAVAILABLE','浏览器组件尚未就绪');return service;
  };
  const ui=(event:IpcMainInvokeEvent)=>host(event).workspace;
  return createScopedRPCController({
    focusChrome:event=>{ui(event);event.sender.focus();},
    snapshot:(event,input:{taskId:string})=>ui(event).snapshot(browserTaskInput.parse(input).taskId),
    create:(event,input:{taskId:string})=>ui(event).create(browserTaskInput.parse(input).taskId),
    select:(event,input:{taskId:string;tabId:string|null})=>{const w=ui(event),v=browserTaskInput.extend({tabId:z.string().uuid().nullable()}).strict().parse(input);return w.select(v.taskId,v.tabId);},
    navigate:(event,input:{taskId:string;tabId:string;address:string})=>{const w=ui(event),v=browserNavigationInput.parse(input);return w.navigate(v.taskId,v.tabId,v.address);},
    action:(event,input:{taskId:string;tabId:string;action:'reload'|'hard-reload'|'stop'|'back'|'forward'|'focus'})=>{const w=ui(event),v=browserActionInput.parse(input);return w.action(v.taskId,v.tabId,v.action);},
    placement:(event,input:{taskId:string;tabId:string;rect:Electron.Rectangle|null})=>{const w=ui(event),v=browserPlacementInput.parse(input);return w.placement(v.taskId,v.tabId,v.rect);},
    close:(event,input:{taskId:string;tabId:string})=>{const w=ui(event),v=browserTabInput.parse(input);return w.close(v.taskId,v.tabId);},
    reopen:(event,input:{taskId:string})=>ui(event).reopen(browserTaskInput.parse(input).taskId),
    find:(event,input:{taskId:string;tabId:string;text:string;forward:boolean;next:boolean})=>{const w=ui(event),v=browserTabInput.extend({text:z.string(),forward:z.boolean(),next:z.boolean()}).strict().parse(input);return w.find(v.taskId,v.tabId,v.text,v.forward,v.next);},
    external:(event,input:{taskId:string;id:string;allow:boolean})=>{const w=ui(event),v=browserTaskInput.extend({id:z.string().uuid(),allow:z.boolean()}).strict().parse(input);return w.confirmExternal(v.taskId,v.id,v.allow);},
    overlay:(event,input:{taskId:string;tabId:string;open:boolean})=>{const w=ui(event),v=browserTabInput.extend({open:z.boolean()}).strict().parse(input);return w.overlay(v.taskId,v.tabId,v.open);},
    preferences:(event,input:{taskId:string})=>host(event).preferences(browserTaskInput.parse(input).taskId),
    settings:(event,input:{taskId:string;searchEngine?:'bing'|'google'|'duckduckgo'|'kagi';identity?:'clean'|'native'})=>{
      const s=host(event),v=browserTaskInput.extend({searchEngine:browserSettingsSchema.shape.searchEngine.optional(),identity:browserSettingsSchema.shape.identity.optional()}).strict().parse(input);s.workspace.snapshot(v.taskId);
      if(v.searchEngine!==undefined)s.settings.setSearchEngine(v.searchEngine);if(v.identity!==undefined)s.settings.setIdentity(v.identity);return s.preferences(v.taskId);
    },
    clearArtifacts:(event,input:{taskId:string;confirmed:true})=>{const s=host(event),v=browserTaskInput.extend({confirmed:z.literal(true)}).strict().parse(input);return s.clearArtifacts(v.taskId);},
    continueCertificate:(event,input:{taskId:string;tabId:string;challengeId:string})=>{const s=host(event),v=browserTabInput.extend({challengeId:z.string().uuid()}).strict().parse(input);return s.continueCertificate(v.taskId,v.tabId,v.challengeId);},
    profileSiteStates:(event,input:{taskId:string})=>host(event).profileSiteStates(browserTaskInput.parse(input).taskId),
    revokeCertificate:(event,input:{taskId:string;profileId:string;host:string})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string(),host:z.string()}).strict().parse(input);s.revokeCertificate(v.taskId,v.profileId,v.host);return s.profileSiteStates(v.taskId);},
  });
}
