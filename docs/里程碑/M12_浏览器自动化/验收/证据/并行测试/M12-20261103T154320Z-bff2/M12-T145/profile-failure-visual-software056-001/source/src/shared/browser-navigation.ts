// Adapted from Orca bd9455b6165 browser-url.ts/browser-load-failure.ts (MIT).
// Copyright (c) 2026 Lovecast Inc. See licenses/M12/Orca-MIT.txt.
// WillYou: Bing default; no SSH/extension routing; recovery follows M12 R01.4.
export const BROWSER_BLANK_URL = 'about:blank';
export const SEARCH_ENGINES = {
  bing: {label:'Bing',url:'https://www.bing.com/search?q='},
  google: {label:'Google',url:'https://www.google.com/search?q='},
  duckduckgo: {label:'DuckDuckGo',url:'https://duckduckgo.com/?q='},
  kagi: {label:'Kagi',url:'https://kagi.com/search?q='},
} as const;
export type BrowserSearchEngine = keyof typeof SEARCH_ENGINES;
const local = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i;
const dns = (name:string) => name.length>0&&name.length<=253&&name.split('.').every(label=>label.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));

/** Address bars opt into search; CLI navigation uses URL validation without search fallback. */
export function normalizeBrowserNavigationUrl(raw:string,engine?:BrowserSearchEngine):string|null {
  const input=raw.trim();
  if(!input||input===BROWSER_BLANK_URL)return BROWSER_BLANK_URL;
  if(/[\u0000-\u001f\u007f]/.test(input))return null;
  try{
    if(local.test(input))return new URL('http://'+input).href;
    if(input.startsWith('/')||/^[A-Za-z]:[\\/]/.test(input)){
      const path=input.replaceAll('\\','/'),parts=path.split('/').map((part,i)=>i===0&&/^[A-Za-z]:$/.test(part)?part:encodeURIComponent(part));
      return(path.startsWith('/')?'file://':'file:///')+parts.join('/');
    }
    if(/^\\\\[^\s\\/]+[\\/]/.test(input)){
      const [host,...parts]=input.replaceAll('\\','/').replace(/^\/+/, '').split('/');
      return'file://'+host+'/'+parts.map(encodeURIComponent).join('/');
    }
    // Check host:port before URL(), which treats the hostname as a scheme.
    const match=/^([^\s/\\:@?#]+):\d+(?:[/?#].*)?$/.exec(input);
    if(match?.[1].includes('.')){
      const parsed=new URL('https://'+input),host=parsed.hostname.toLowerCase().replace(/\.$/,'');
      if(!dns(host))return null;
      // Reparse the original authority: HTTPS parsing already removes :443.
      return host.endsWith('.localhost')?new URL('http://'+input).href:parsed.href;
    }
    try{
      const parsed=new URL(input);
      return['http:','https:','file:'].includes(parsed.protocol)?parsed.href:null;
    }catch{
      if(/^[a-z][a-z0-9+.-]*:\/\//i.test(input))return null;
      try{
        const parsed=new URL('https://'+input);
        const prose=/\s/.test(input)||!input.includes('.')&&!input.includes(':');
        if(engine===undefined||!prose){
          return parsed.hostname.toLowerCase().replace(/\.$/,'').endsWith('.localhost')?new URL('http://'+input).href:parsed.href;
        }
      }catch{/* Search fallback below. */}
      return engine===undefined?null:SEARCH_ENGINES[engine].url+encodeURIComponent(input);
    }
  }catch{return null;}
}
export function isBrowserSearchUrl(raw:string):boolean {
  try{const u=new URL(raw);return Object.values(SEARCH_ENGINES).some(e=>{const base=new URL(e.url);return u.origin===base.origin&&u.pathname===base.pathname&&u.searchParams.has('q');});}catch{return false;}
}
export type BrowserFailureKind='not-running'|'refused'|'dns'|'offline'|'timeout'|'reset'|'other';
export interface BrowserLoadFailure {kind:BrowserFailureKind;url:string;host:string;title:string;errorName:string;recovery:'poll'|'online'|null}
export function describeBrowserLoadFailure(code:number,description:string,url:string):BrowserLoadFailure {
  let host='',localHost=false;
  try{const u=new URL(url);host=u.host;localHost=u.hostname==='localhost'||u.hostname.endsWith('.localhost')||/^127\./.test(u.hostname)||['[::1]','0.0.0.0','[::]'].includes(u.hostname);}catch{/* Invalid destinations use a generic message. */}
  const kind:BrowserFailureKind=code===-102?(localHost?'not-running':'refused'):code===-106?'offline':[-105,-137].includes(code)?'dns':[-7,-118].includes(code)?'timeout':[-100,-101,-103,-324].includes(code)?'reset':'other';
  const titles:Record<BrowserFailureKind,string>={'not-running':`${host} 上还没有服务在运行`,refused:`${host} 拒绝连接`,dns:`找不到 ${host}`,offline:'当前处于离线状态',timeout:`${host} 响应时间过长`,reset:`与 ${host} 的连接被中断`,other:host?`无法访问 ${host}`:'无法加载此页面'};
  return{kind,url,host,title:titles[kind],errorName:/^(?:net::)?(ERR_[A-Z0-9_]+)$/.exec(description)?.[1]??description,recovery:kind==='not-running'?'poll':kind==='offline'?'online':null};
}
