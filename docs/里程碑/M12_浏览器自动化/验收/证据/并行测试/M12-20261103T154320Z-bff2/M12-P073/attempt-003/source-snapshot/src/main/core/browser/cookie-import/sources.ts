// Source locations/keychain labels follow Orca bd9455b6165 (MIT; Lovecast Inc.).
// Discovery never asks for a key. Only the confirmed UI import coordinator may
// call prepare; neither source paths nor a Keychain password cross renderer IPC.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,basename} from 'node:path';
import {lstat,readdir,readFile,mkdir,chmod} from 'node:fs/promises';
import {z} from 'zod';
import {browserCookieSourceSchema,type BrowserCookieFamily,type BrowserCookieSource,type BrowserCookieSourceList} from '@shared/browser-cookie-import';
import {BrowserCookieSourceError,deriveMacChromiumCookieKey} from './chromium-source';
import {readChromiumCookies} from './source-rows';
const browsers=[
  {family:'chrome',label:'Google Chrome',folder:'Google/Chrome',service:'Chrome Safe Storage',account:'Chrome'},
  {family:'edge',label:'Microsoft Edge',folder:'Microsoft Edge',service:'Microsoft Edge Safe Storage',account:'Microsoft Edge'},
] satisfies {family:BrowserCookieFamily;label:string;folder:string;service:string;account:string}[];
const localStateSchema=z.object({profile:z.object({info_cache:z.record(z.string(),z.object({name:z.string().optional()}).passthrough())}).passthrough()}).passthrough();
async function regular(path:string,kind:'file'|'directory'):Promise<boolean>{
  try{const s=await lstat(path);return!s.isSymbolicLink()&&(kind==='file'?s.isFile():s.isDirectory());}
  catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return false;throw new BrowserCookieSourceError('source-unreadable','无法读取来源浏览器目录');}
}
export function readMacBrowserCookieKey(family:BrowserCookieFamily):Promise<Buffer>{
  const browser=browsers.find(value=>value.family===family);if(!browser||process.platform!=='darwin')return Promise.reject(new BrowserCookieSourceError('source-unreadable','当前平台没有所选浏览器的钥匙串读取能力'));
  return new Promise((resolve,reject)=>{
    execFile('/usr/bin/security',['find-generic-password','-s',browser.service,'-a',browser.account,'-w'],{encoding:'buffer',timeout:30000,maxBuffer:65536,windowsHide:true},(error,stdout,stderr)=>{
      try{
        if(error)throw new BrowserCookieSourceError(error.killed?'keychain-timeout':'keychain-denied',error.killed?'等待钥匙串授权超时；未写入Cookie':'钥匙串授权被拒绝或不可用；未写入Cookie');
        // security appends one line ending. Preserve other password bytes.
        let length=stdout.length;if(length&&stdout[length-1]===10){length--;if(length&&stdout[length-1]===13)length--;}
        if(!length)throw new BrowserCookieSourceError('keychain-denied','钥匙串未返回可用口令；未写入Cookie');resolve(deriveMacChromiumCookieKey(stdout.subarray(0,length)));
      }catch(error){reject(error);}finally{stdout.fill(0);stderr.fill(0);}
    });
  });
}
interface Selection {source:BrowserCookieSource;directory:string;cookies:string|null}
export class BrowserCookieSources {
  private readonly selected=new Map<string,Selection>();
  private readonly root:string;
  constructor(private readonly options:{applicationSupport?:string;temporaryRoot?:string;keychain?:(family:BrowserCookieFamily)=>Promise<Buffer>}={}){this.root=options.applicationSupport??join(homedir(),'Library/Application Support');}
  async discover():Promise<BrowserCookieSourceList>{
    const result:BrowserCookieSourceList={browsers:[]},next=new Map<string,Selection>();
    for(const browser of browsers){
      const directory=join(this.root,browser.folder),installed=await regular(directory,'directory'),profiles:BrowserCookieSource[]=[];result.browsers.push({family:browser.family,label:browser.label,installed,profiles});if(!installed)continue;
      let names:Record<string,{name?:string}>={};
      try{const file=join(directory,'Local State');if(await regular(file,'file')){const metadata=await lstat(file);if(metadata.size<=16*1024*1024){const parsed=localStateSchema.safeParse(JSON.parse(await readFile(file,'utf8')));if(parsed.success)names=parsed.data.profile.info_cache;}}}catch{/* Discovery can still enumerate ordinary Chrome/Edge profile directories. */}
      const entries=new Set([...Object.keys(names),...(await readdir(directory)).filter(name=>name==='Default'||/^Profile \d+$/.test(name))]);
      for(const profileDirectory of [...entries].sort()){
        if(profileDirectory!==basename(profileDirectory)||profileDirectory==='.'||profileDirectory==='..'||/[\\/\u0000]/.test(profileDirectory))continue;
        const profilePath=join(directory,profileDirectory);if(!await regular(profilePath,'directory'))continue;let cookies:string|null=null;
        const candidates=[...(await regular(join(profilePath,'Network'),'directory')?[join(profilePath,'Network/Cookies')]:[]),join(profilePath,'Cookies')];
        for(const candidate of candidates)if(await regular(candidate,'file')){cookies=candidate;break;}
        const id=createHash('sha256').update(JSON.stringify([browser.family,directory,profileDirectory])).digest('hex'),source=browserCookieSourceSchema.parse({id,family:browser.family,browserLabel:browser.label,profileName:names[profileDirectory]?.name||profileDirectory,profileDirectory,hasCookies:cookies!==null});profiles.push(source);next.set(id,{source,directory:profilePath,cookies});
      }
    }
    this.selected.clear();for(const[id,value]of next)this.selected.set(id,value);return result;
  }
  async prepare(id:string){
    const selected=this.selected.get(id);if(!selected||!await regular(selected.directory,'directory'))throw new BrowserCookieSourceError('source-missing','所选浏览器或profile已不存在，请重新选择');
    if(!selected.cookies||!await regular(selected.cookies,'file'))throw new BrowserCookieSourceError('source-missing','所选profile没有可读取的Cookie库');
    if(this.options.temporaryRoot){await mkdir(this.options.temporaryRoot,{recursive:true,mode:0o700});if(!await regular(this.options.temporaryRoot,'directory'))throw new BrowserCookieSourceError('source-unreadable','导入临时目录不可用');await chmod(this.options.temporaryRoot,0o700);}
    const family=selected.source.family,prepared=await readChromiumCookies({databasePath:selected.cookies,temporaryRoot:this.options.temporaryRoot,getKey:()=>this.options.keychain?.(family)??readMacBrowserCookieKey(family)});
    return{...prepared,source:{...selected.source}};
  }
}
