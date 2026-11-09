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
    overlay:(event,input:{taskId:string;tabId:string;open:boolean;capture?:boolean;owner?:string})=>{const w=ui(event),v=browserTabInput.extend({open:z.boolean(),capture:z.boolean().optional(),owner:z.string().min(1).max(128).optional()}).strict().parse(input);return w.overlay(v.taskId,v.tabId,v.open,v.capture,v.owner);},
    preferences:(event,input:{taskId:string})=>host(event).preferences(browserTaskInput.parse(input).taskId),
    settings:(event,input:{taskId:string;searchEngine?:'bing'|'google'|'duckduckgo'|'kagi';identity?:'clean'|'native'})=>{
      const s=host(event),v=browserTaskInput.extend({searchEngine:browserSettingsSchema.shape.searchEngine.optional(),identity:browserSettingsSchema.shape.identity.optional()}).strict().parse(input);s.workspace.snapshot(v.taskId);
      if(v.searchEngine!==undefined)s.settings.setSearchEngine(v.searchEngine);if(v.identity!==undefined)s.settings.setIdentity(v.identity);return s.preferences(v.taskId);
    },
    clearArtifacts:(event,input:{taskId:string;confirmed:true})=>{const s=host(event),v=browserTaskInput.extend({confirmed:z.literal(true)}).strict().parse(input);return s.clearArtifacts(v.taskId);},
    continueCertificate:(event,input:{taskId:string;tabId:string;challengeId:string})=>{const s=host(event),v=browserTabInput.extend({challengeId:z.string().uuid()}).strict().parse(input);return s.continueCertificate(v.taskId,v.tabId,v.challengeId);},
    profileSiteStates:(event,input:{taskId:string})=>host(event).profileSiteStates(browserTaskInput.parse(input).taskId),
    accessState:event=>host(event).accessState(),
    respondAccess:(event,input:{id:string;allow:boolean;mode?:'observe'|'control'})=>{const s=host(event),v=z.object({id:z.uuid(),allow:z.boolean(),mode:z.enum(['observe','control']).optional()}).strict().parse(input);s.respondAccess(v.id,v.allow,v.mode);},
    revokeAccess:(event,input:{id:string})=>{const s=host(event),v=z.object({id:z.uuid()}).strict().parse(input);s.revokeAccess(v.id);},
    pause:(event,input:{taskId:string;paused:boolean})=>{const s=host(event),v=browserTaskInput.extend({paused:z.boolean()}).strict().parse(input);return s.pauseFromUi(v.taskId,v.paused);},
    createProfile:(event,input:{taskId:string;label:string})=>{const s=host(event),v=browserTaskInput.extend({label:z.string().trim().min(1).max(120)}).strict().parse(input);return s.createProfile(v.taskId,v.label);},
    cloneProfile:(event,input:{taskId:string;profileId:string})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string()}).strict().parse(input);return s.cloneProfile(v.taskId,v.profileId);},
    useProfile:(event,input:{taskId:string;tabId:string;profileId:string})=>{const s=host(event),v=browserTabInput.extend({profileId:z.string()}).strict().parse(input);return s.useProfile(v.taskId,v.tabId,v.profileId);},
    deleteProfile:(event,input:{taskId:string;profileId:string;confirmed:true})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string(),confirmed:z.literal(true)}).strict().parse(input);return s.deleteProfile(v.taskId,v.profileId);},
    importCookieSources:(event,input:{taskId:string})=>host(event).importCookieSources(browserTaskInput.parse(input).taskId),
    importCookies:(event,input:{taskId:string;profileId:string;sourceId:string;confirmed:true})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string(),sourceId:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict().parse(input);return s.importCookies(v.taskId,v.profileId,v.sourceId);},
    recoverCookies:(event,input:{taskId:string;profileId:string})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string()}).strict().parse(input);return s.recoverCookies(v.taskId,v.profileId);},
    clearCookies:(event,input:{taskId:string;profileId:string;confirmed:true})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string(),confirmed:z.literal(true)}).strict().parse(input);return s.clearCookies(v.taskId,v.profileId);},
    revokeCertificate:(event,input:{taskId:string;profileId:string;host:string})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string(),host:z.string()}).strict().parse(input);s.revokeCertificate(v.taskId,v.profileId,v.host);return s.profileSiteStates(v.taskId);},
    respondPermission:(event,input:{taskId:string;id:string;allow:boolean})=>{const s=host(event),v=browserTaskInput.extend({id:z.string().uuid(),allow:z.boolean()}).strict().parse(input);s.respondPermission(v.taskId,v.id,v.allow);},
    revokePermission:(event,input:{taskId:string;profileId:string;origin:string;permission:string})=>{const s=host(event),v=browserTaskInput.extend({profileId:z.string(),origin:z.string(),permission:z.string()}).strict().parse(input);s.revokePermission(v.taskId,v.profileId,v.origin,v.permission);return s.profileSiteStates(v.taskId);},
    downloadAction:(event,input:{taskId:string;id:string;action:'cancel'|'open'|'reveal'|'remove'})=>{const s=host(event),v=browserTaskInput.extend({id:z.string().uuid(),action:z.enum(['cancel','open','reveal','remove'])}).strict().parse(input);return s.downloadAction(v.taskId,v.id,v.action);},
    respondAuthentication:(event,input:{taskId:string;id:string;credentials:{user:string;pass:string}|null})=>{const s=host(event),v=browserTaskInput.extend({id:z.string().uuid(),credentials:z.object({user:z.string(),pass:z.string()}).strict().nullable()}).strict().parse(input);s.respondAuthentication(v.taskId,v.id,v.credentials);},
    respondJavascriptDialog:(event,input:{taskId:string;id:string;accept:boolean;text?:string})=>{const s=host(event),v=browserTaskInput.extend({id:z.string().uuid(),accept:z.boolean(),text:z.string().optional()}).strict().parse(input);return s.respondJavascriptDialog(v.taskId,v.id,v.accept,v.text);},
    retryAuthentication:(event,input:{taskId:string;tabId:string})=>{const s=host(event),v=browserTabInput.parse(input);return s.retryAuthentication(v.taskId,v.tabId);},
  });
}
