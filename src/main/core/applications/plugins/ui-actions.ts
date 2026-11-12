import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import {pluginUiActionRequestSchema,type PluginUiActionRequest,type PreparedPluginUiAction} from '@shared/plugin-actions';
import {pluginListView,pluginPanelInput,pluginUiField,resolvePluginUiTemplate,type PluginUiScopes} from '@shared/plugin-ui';
import {sanitizeTerminalText,TERMINAL_CONTEXT_LIMITS} from '@shared/file-terminal';
import type {PluginPanel,PluginUiRead} from '@shared/plugins';
import {canonicalJson} from '../manifest';

interface ReadReceipt {owner:string;input:PluginUiRead;panel:PluginPanel;displayName:string;value:unknown;summary:Record<string,unknown>;connectionScope:string;expiresAt:number;bytes:number;check():void}
interface ActionReceipt {owner:string;value:PreparedPluginUiAction;check():void}
/** Bounded, ephemeral UI proofs. Templates resolve against actual host-retained results, never renderer JSON. */
export class PluginUiActions {
  private readonly reads=new Map<string,ReadReceipt>();
  private readonly actions=new Map<string,ActionReceipt>();
  constructor(private readonly now:()=>number=Date.now){}
  private prune(){for(const[id,r]of this.reads)if(r.expiresAt<=this.now())this.reads.delete(id);for(const[id,a]of this.actions)if(a.value.expiresAt<=this.now())this.actions.delete(id);}
  remember(owner:string,input:PluginUiRead,panel:PluginPanel,displayName:string,value:unknown,summary:Record<string,unknown>,connectionScope:string,check:()=>void):string|undefined {
    const listNeeded=input.capability===panel.source.capability&&(panel.rowActions.length||Object.values(panel.details).some(d=>d.actions.length));
    if(!listNeeded&&!Object.values(panel.details).some(d=>d.source.capability===input.capability&&d.actions.length))return undefined;
    this.prune();const bytes=Buffer.byteLength(JSON.stringify({input,value,summary,panel}));
    if(this.reads.size>=128||[...this.reads.values()].filter(r=>r.owner===owner).length>=32||[...this.reads.values()].reduce((n,r)=>n+r.bytes,0)+bytes>16*1024*1024)throw new ApplicationError('RESOURCE_BUSY','插件页面引用过多，请关闭旧页面后刷新');
    const id=randomUUID();this.reads.set(id,{owner,input:structuredClone(input),panel:structuredClone(panel),displayName,value:structuredClone(value),summary:structuredClone(summary),connectionScope,expiresAt:this.now()+300000,bytes,check});return id;
  }
  private read(owner:string,id:string){const r=this.reads.get(id);if(!r||r.owner!==owner||r.expiresAt<=this.now())throw new ApplicationError('INTENT_STALE','原页面引用已失效，请刷新后操作');r.check();return r;}
  prepare(owner:string,raw:PluginUiActionRequest):PreparedPluginUiAction {
    this.prune();const input=pluginUiActionRequestSchema.parse(raw),read=this.read(owner,input.receiptId),origin=this.read(owner,input.row.receiptId),panel=read.panel;
    if(canonicalJson([read.input.projectId,read.input.appId,read.input.panelId,read.input.packageHash,read.connectionScope])!==canonicalJson([origin.input.projectId,origin.input.appId,origin.input.panelId,origin.input.packageHash,origin.connectionScope])||origin.input.capability!==panel.source.capability)throw new ApplicationError('SCOPE_DENIED','引用与原列表不是同一页面或连接');
    const row=pluginListView(panel,origin.value).rows[input.row.index]?.value;
    if(!row)throw new ApplicationError('INVALID_INPUT','原列表没有此行');
    const tab=input.row.tabId?panel.tabs.find(t=>t.id===input.row.tabId):undefined;
    if(panel.tabs.length&&!tab||!panel.tabs.length&&input.row.tabId)throw new ApplicationError('INVALID_INPUT','原列表页签无效');
    const scopes:PluginUiScopes={row,tab,connection:{summary:origin.summary}},expected=pluginPanelInput(panel,scopes);
    for(const[key,value]of Object.entries(expected))if(!Object.hasOwn(origin.input.input,key)||canonicalJson(origin.input.input[key])!==canonicalJson(value))throw new ApplicationError('SCOPE_DENIED','页签与原列表输入不符');
    let declaration:PluginPanel['rowActions'][number]|undefined;
    if(input.detailId){
      const detail=Object.hasOwn(panel.details,input.detailId)?panel.details[input.detailId]:undefined;
      if(!detail||panel.onRowOpen?.detail!==input.detailId||read.input.capability!==detail.source.capability||canonicalJson(read.input.input)!==canonicalJson(resolvePluginUiTemplate(detail.source.input??{},scopes)))throw new ApplicationError('SCOPE_DENIED','详情不是原列表此行的读取结果');
      declaration=detail.actions[input.actionIndex];scopes.value=read.value;scopes.connection={summary:read.summary};
    }else{
      if(input.receiptId!==input.row.receiptId)throw new ApplicationError('SCOPE_DENIED','行操作不是原列表结果');
      declaration=panel.rowActions[input.actionIndex];
    }
    if(!declaration)throw new ApplicationError('SCOPE_DENIED','插件页面未声明此动作');
    const base={id:randomUUID(),appId:read.input.appId,projectId:read.input.projectId,title:declaration.title,closeOnDone:declaration.closeOnDone??false,expiresAt:Math.min(read.expiresAt,origin.expiresAt)};
    let value:PreparedPluginUiAction;
    if(declaration.kind==='openUrl'){
      const url=declaration.field?pluginUiField(input.detailId?read.value:row,declaration.field):pluginUiField(resolvePluginUiTemplate(declaration.payload??{},scopes),'url');
      if(typeof url!=='string'||url.length>8192||/[\x00-\x20\x7f-\x9f]/u.test(url))throw new ApplicationError('INVALID_INPUT','插件链接不是有效的网址');
      let parsed:URL;try{parsed=new URL(url);}catch{throw new ApplicationError('INVALID_INPUT','插件链接不是有效的网址');}
      if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new ApplicationError('SCOPE_DENIED','只允许打开不含账号密码的 HTTP(S) 网址');
      value={...base,kind:'openUrl',url:parsed.href};
    }else{
      const payload=resolvePluginUiTemplate(declaration.payload??{},scopes);
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Object.keys(payload).length)throw new ApplicationError('INVALID_INPUT','插件没有提供可插入的引用');
      const text=sanitizeTerminalText(`[插件 ${read.displayName} (${read.input.appId}) 的原对象引用]\n${JSON.stringify(payload)}\n请使用该插件核对原对象后继续处理。`).text;
      if(text.length>TERMINAL_CONTEXT_LIMITS.total)throw new ApplicationError('TOO_LARGE','插件引用超过终端输入上限');
      value={...base,kind:'insertTerminal',text};
    }
    if(this.actions.size>=128||[...this.actions.values()].filter(a=>a.owner===owner).length>=16)throw new ApplicationError('RESOURCE_BUSY','插件页面动作过多，请关闭旧页面后重试');
    this.actions.set(value.id,{owner,value,check:()=>{this.read(owner,input.receiptId);this.read(owner,input.row.receiptId);}});return structuredClone(value);
  }
  proof(owner:string,id:string){
    const assert=()=>{const a=this.actions.get(id);if(!a||a.owner!==owner||a.value.expiresAt<=this.now())throw new ApplicationError('INTENT_STALE','原页面动作已失效，请重新选择');a.check();return a;};
    const a=assert();return{value:structuredClone(a.value),assert:()=>{assert();}};
  }
  consume(owner:string,id:string){
    const proof=this.proof(owner,id),a=this.actions.get(id)!;this.actions.delete(id);
    return{value:proof.value,assert:()=>{if(a.value.expiresAt<=this.now())throw new ApplicationError('INTENT_STALE','原页面动作已过期');a.check();}};
  }
  release(owner:string,id:string){if(this.actions.get(id)?.owner===owner)this.actions.delete(id);return{released:true};}
  close(){this.reads.clear();this.actions.clear();}
}
