import {z} from 'zod';
import {WebContentsView,type Session,type WebContents} from 'electron';
import {ApplicationError} from '@shared/applications';
import {browserImportCookieSchema,type BrowserImportCookie} from './journal';
import type {BrowserImportTargetCookie} from './plan';

const nativeCookieSchema=z.object({
  name:z.string(),value:z.string(),domain:z.string().min(1),path:z.string(),secure:z.boolean(),httpOnly:z.boolean(),session:z.boolean(),expires:z.number().finite(),
  sameSite:z.enum(['Strict','Lax','None']).optional(),priority:z.enum(['Low','Medium','High']).optional(),
  sourceScheme:z.enum(['Unset','NonSecure','Secure']).optional(),sourcePort:z.number().int().min(-1).max(65535).optional(),
  partitionKey:z.unknown().optional(),partitionKeyOpaque:z.unknown().optional(),
}).passthrough();
const responseSchema=z.object({cookies:z.array(nativeCookieSchema)});
const partitionSchema=browserImportCookieSchema.shape.partitionKey.unwrap();
export function decodeNativeImportCookies(value:unknown):BrowserImportTargetCookie[]{
  const response=responseSchema.parse(value);
  return response.cookies.map(raw=>{
    let partitionKey:BrowserImportCookie['partitionKey']=null;
    if(raw.partitionKeyOpaque===true||raw.partitionKeyOpaque!==undefined&&typeof raw.partitionKeyOpaque!=='boolean')return{kind:'unreadable-partition',domain:raw.domain};
    if(raw.partitionKey!==undefined){const parsed=partitionSchema.safeParse(raw.partitionKey);if(!parsed.success)return{kind:'unreadable-partition',domain:raw.domain};partitionKey=parsed.data;}
    return{kind:'readable',cookie:browserImportCookieSchema.parse({name:raw.name,value:raw.value,domain:raw.domain,path:raw.path,secure:raw.secure,httpOnly:raw.httpOnly,hostOnly:!raw.domain.startsWith('.'),expirationDate:raw.session?null:raw.expires,partitionKey,
      sameSite:raw.sameSite==='Strict'?'strict':raw.sameSite==='Lax'?'lax':raw.sameSite==='None'?'no_restriction':'unspecified',
      ...(raw.priority===undefined?{}:{priority:raw.priority}),...(raw.sourceScheme===undefined?{}:{sourceScheme:raw.sourceScheme}),...(raw.sourcePort===undefined?{}:{sourcePort:raw.sourcePort}),
    })};
  });
}
export function nativeImportCookieParameters(input:BrowserImportCookie){
  const cookie=browserImportCookieSchema.parse(input),url=new URL((cookie.sourceScheme==='Secure'||cookie.secure?'https':'http')+'://'+cookie.domain.replace(/^\./,'')+'/');url.pathname=cookie.path;
  return{url:url.href,name:cookie.name,value:cookie.value,path:cookie.path,secure:cookie.secure,httpOnly:cookie.httpOnly,...(cookie.hostOnly?{}:{domain:cookie.domain}),
    ...(cookie.sameSite==='unspecified'?{}:{sameSite:cookie.sameSite==='strict'?'Strict':cookie.sameSite==='lax'?'Lax':'None'}),...(cookie.expirationDate===null?{}:{expires:cookie.expirationDate}),
    ...(cookie.partitionKey===null?{}:{partitionKey:cookie.partitionKey}),...(cookie.priority===undefined?{}:{priority:cookie.priority}),...(cookie.sourceScheme===undefined?{}:{sourceScheme:cookie.sourceScheme}),...(cookie.sourcePort===undefined?{}:{sourcePort:cookie.sourcePort}),
  };
}
export interface BrowserCookieMutationStore {
  snapshot():Promise<BrowserImportTargetCookie[]>;set(cookie:BrowserImportCookie):Promise<void>;remove(cookie:BrowserImportCookie):Promise<void>;flush():Promise<void>;
}
/** Host-only adapter for the exact selected native Session. A private blank
 * WebContents gives CDP full partition identities without disturbing any
 * production page debugger. It is never registered as an Agent-visible page. */
export class NativeBrowserCookieStore implements BrowserCookieMutationStore {
  private constructor(private readonly session:Session,private readonly view:WebContentsView){}
  private get contents(){return this.view.webContents;}
  static async open(session:Session,configure?:(contents:WebContents)=>void):Promise<NativeBrowserCookieStore>{
    const view=new WebContentsView({webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{configure?.(view.webContents);await view.webContents.loadURL('about:blank');view.webContents.debugger.attach('1.3');await view.webContents.debugger.sendCommand('Network.enable');return new NativeBrowserCookieStore(session,view);}
    catch{if(!view.webContents.isDestroyed())view.webContents.close({waitForBeforeUnload:false});throw new ApplicationError('BROWSER_UNAVAILABLE','无法准备所选登录态的Cookie存储');}
  }
  async snapshot():Promise<BrowserImportTargetCookie[]>{const value:unknown=await this.contents.debugger.sendCommand('Network.getAllCookies');return decodeNativeImportCookies(value);}
  async set(cookie:BrowserImportCookie):Promise<void>{
    const value:unknown=await this.contents.debugger.sendCommand('Network.setCookie',nativeImportCookieParameters(cookie));if(!z.object({success:z.literal(true)}).safeParse(value).success)throw new ApplicationError('BROWSER_ERROR','浏览器未确认Cookie写入');
  }
  async remove(input:BrowserImportCookie):Promise<void>{const cookie=browserImportCookieSchema.parse(input);await this.contents.debugger.sendCommand('Network.deleteCookies',{name:cookie.name,domain:cookie.domain,path:cookie.path,...(cookie.partitionKey===null?{}:{partitionKey:cookie.partitionKey})});}
  async flush():Promise<void>{await this.session.cookies.flushStore();}
  async close():Promise<void>{
    const contents=this.contents;if(contents.isDestroyed())return;const closed=new Promise<void>(resolve=>contents.once('destroyed',()=>resolve()));if(contents.debugger.isAttached())contents.debugger.detach();contents.close({waitForBeforeUnload:false});await closed;
  }
}
