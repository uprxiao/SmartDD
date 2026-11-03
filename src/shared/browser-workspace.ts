import {z} from 'zod';
import type {BrowserLoadFailure} from './browser-navigation';
export const browserTabSchema=z.object({id:z.string().uuid(),url:z.string(),title:z.string(),profileId:z.string(),favicon:z.string().nullable()}).strict();
export const browserWorkspaceSchema=z.object({version:z.literal(1),tabs:z.array(browserTabSchema),activeId:z.string().uuid().nullable(),closed:z.array(browserTabSchema).max(10)}).strict().superRefine((state,ctx)=>{
  if(new Set(state.tabs.map(t=>t.id)).size!==state.tabs.length||state.activeId&&!state.tabs.some(t=>t.id===state.activeId))ctx.addIssue({code:'custom',message:'网页标签身份无效'});
});
export type SavedBrowserTab=z.infer<typeof browserTabSchema>;
export type SavedBrowserWorkspace=z.infer<typeof browserWorkspaceSchema>;
export interface BrowserTabState extends SavedBrowserTab {loading:boolean;canGoBack:boolean;canGoForward:boolean;failure:BrowserLoadFailure|null}
export type BrowserShortcut='new'|'reopen'|'close'|'reload'|'hard-reload'|'back'|'forward'|'address'|'find';
export interface BrowserWorkspaceState {taskId:string;projectId:string;tabs:BrowserTabState[];activeId:string|null;recent:{url:string;title:string;host:string;visitedAt:number}[];notice:string|null;external:{id:string;url:string}|null;find:{active:number;total:number}}
const id=z.string().uuid();
export const browserTaskInput=z.object({taskId:id}).strict();
export const browserTabInput=browserTaskInput.extend({tabId:id}).strict();
export const browserNavigationInput=browserTabInput.extend({address:z.string()}).strict();
export const browserActionInput=browserTabInput.extend({action:z.enum(['reload','hard-reload','stop','back','forward','focus'])}).strict();
export const browserPlacementInput=browserTabInput.extend({rect:z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().positive().finite(),height:z.number().positive().finite()}).strict().nullable()}).strict();
