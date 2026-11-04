// CDP cookie contracts adapted from Orca bd9455b6165 cdp-auxiliary-commands
// MIT, Copyright (c) 2026 Lovecast Inc. Each sender is the host's scoped page proxy.
import {ApplicationError} from '@shared/applications';
import type {BrowserPage} from './page-registry';
import {BrowserError} from './errors';

const text=(value:unknown)=>{if(!['string','number','boolean'].includes(typeof value))throw new ApplicationError('INVALID_INPUT','Cookie字段须为文本');return String(value);};
function cookieUrl(value:unknown):string{
  let url:URL;try{url=new URL(text(value));}catch{throw new ApplicationError('INVALID_INPUT','Cookie地址须为有效HTTP(S)地址');}
  if(!['http:','https:'].includes(url.protocol))throw new ApplicationError('INVALID_INPUT','Cookie地址须为有效HTTP(S)地址');return url.href;
}
export function browserCookieParameters(command:string,args:Record<string,unknown>,currentUrl:string):{method:string;params:Record<string,unknown>;write:boolean}{
  if(command==='cookie get')return{method:'Network.getCookies',params:args.url===undefined?{}:{urls:[cookieUrl(args.url)]},write:false};
  const name=text(args.name);if(!name||/[\s=;,\u0000-\u001f\u007f]/.test(name))throw new ApplicationError('INVALID_INPUT','Cookie名称无效');
  let domain:string|undefined;
  if(args.domain!==undefined){
    domain=text(args.domain);let normalized:string;
    try{normalized=new URL('https://'+domain.replace(/^\./,'')).hostname;}catch{throw new ApplicationError('INVALID_INPUT','Cookie域名无效');}
    if(!domain||domain.replace(/^\./,'').toLowerCase()!==normalized||/[/:\\\s]/.test(domain))throw new ApplicationError('INVALID_INPUT','Cookie域名无效');
  }
  if(command==='cookie delete')return{method:'Network.deleteCookies',params:{name,...(domain?{domain}:{}),...(args.url!==undefined?{url:cookieUrl(args.url)}:domain?{}:{url:cookieUrl(currentUrl)})},write:true};
  if(command!=='cookie set')throw new ApplicationError('CAPABILITY_UNAVAILABLE','未登记的Cookie命令');
  const value=text(args.value),path=args.path===undefined?'/':text(args.path),sameSite=args.sameSite===undefined?'lax':text(args.sameSite).toLowerCase();
  if(/[\u0000-\u001f\u007f]/.test(value)||!path.startsWith('/')||/[\u0000-\u001f\u007f]/.test(path))throw new ApplicationError('INVALID_INPUT','Cookie值或路径包含不支持的字符');
  const sites:Record<string,string>={lax:'Lax',strict:'Strict',none:'None'};if(!Object.hasOwn(sites,sameSite))throw new ApplicationError('INVALID_INPUT','sameSite须为Lax、Strict或None');
  if(args.expires!==undefined&&(typeof args.expires!=='number'||!Number.isFinite(args.expires)))throw new ApplicationError('INVALID_INPUT','expires须为有限Unix秒数');
  return{method:'Network.setCookie',params:{name,value,...(domain?{domain}:{url:cookieUrl(currentUrl)}),path,secure:args.secure===true,httpOnly:args.httpOnly===true,sameSite:sites[sameSite],...(args.expires===undefined?{}:{expires:args.expires})},write:true};
}
export async function executeBrowserCookie(page:BrowserPage,command:string,args:Record<string,unknown>,send:()=>void):Promise<unknown>{
  const request=browserCookieParameters(command,args,page.contents.getURL());if(request.write)send();
  const result=await page.proxy.send<{success?:boolean;cookies?:unknown[]}>(request.method,request.params);
  if(command==='cookie set'&&result.success!==true)throw new BrowserError('BROWSER_ERROR','Cookie未能保存，请核对域名、secure及sameSite');
  return{result:command==='cookie delete'?{deleted:true}:result};
}
