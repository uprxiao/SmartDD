import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCipheriv,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {BrowserCookieSources,readMacBrowserCookieKey} from '../cookie-import/sources';
const execute=vi.hoisted(()=>vi.fn());vi.mock('node:child_process',()=>({execFile:execute}));
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.resetAllMocks();});
const expectedKey=Buffer.from('67c27378db32f53bc054d194222da644','hex');
function fixture(){const root=mkdtempSync(join(tmpdir(),'willyou-m12-browser-sources-'));roots.push(root);const keychain=vi.fn(async()=>Buffer.from(expectedKey));return{root,keychain,sources:new BrowserCookieSources({applicationSupport:root,temporaryRoot:root,keychain})};}
function database(path:string,encrypted=false){
  const db=new Database(path);try{db.exec('CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES(\'version\',\'24\');CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,is_secure INTEGER,is_httponly INTEGER,expires_utc INTEGER,samesite INTEGER)');let bytes=Buffer.alloc(0);
    if(encrypted){const cipher=createCipheriv('aes-128-cbc',expectedKey,Buffer.alloc(16,0x20)),plain=Buffer.concat([createHash('sha256').update('.source.test').digest(),Buffer.from('source token')]);bytes=Buffer.concat([Buffer.from('v10'),cipher.update(plain),cipher.final()]);}
    db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)').run('.source.test','X',encrypted?'':'plain source',bytes,'/',1,1,0n,1);
  }finally{db.close();}
}
describe('Chrome/Edge source selection without implicit Keychain access',()=>{
  it('discovers only the two allowed families and profiles without reading keys or exposing filesystem paths',async()=>{
    const f=fixture(),chrome=join(f.root,'Google/Chrome'),edge=join(f.root,'Microsoft Edge');mkdirSync(join(chrome,'Default/Network'),{recursive:true});mkdirSync(join(edge,'Profile 2'),{recursive:true});writeFileSync(join(chrome,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Chrome QA'},'../../outside':{name:'must not list'}}}}));database(join(chrome,'Default/Network/Cookies'));database(join(edge,'Profile 2/Cookies'));
    const list=await f.sources.discover();expect(list.browsers.map(b=>[b.family,b.installed])).toEqual([['chrome',true],['edge',true]]);expect(list.browsers[0].profiles).toMatchObject([{profileName:'Chrome QA',profileDirectory:'Default',hasCookies:true}]);expect(list.browsers[1].profiles).toMatchObject([{profileDirectory:'Profile 2',hasCookies:true}]);expect(JSON.stringify(list)).not.toContain(f.root);expect(f.keychain).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();
  });
  it('prepares the exact selected family, calls its key provider once only when needed and never falls back to another profile',async()=>{
    const f=fixture(),dir=join(f.root,'Microsoft Edge/Default/Network');mkdirSync(dir,{recursive:true});database(join(dir,'Cookies'),true);const list=await f.sources.discover(),source=list.browsers[1].profiles[0];const result=await f.sources.prepare(source.id);expect(result.cookies[0].value).toBe('source token');expect(result.source.family).toBe('edge');expect(f.keychain).toHaveBeenCalledExactlyOnceWith('edge');await expect(f.sources.prepare('f'.repeat(64))).rejects.toMatchObject({reason:'source-missing'});expect(f.keychain).toHaveBeenCalledOnce();rmSync(join(dir,'Cookies'));await expect(f.sources.prepare(source.id)).rejects.toMatchObject({reason:'source-missing'});expect(f.keychain).toHaveBeenCalledOnce();
  });
  it('allows a valid legacy database location, handles absent browsers and does not request a key for plaintext cookies',async()=>{
    const f=fixture();expect((await f.sources.discover()).browsers.every(b=>!b.installed)).toBe(true);const dir=join(f.root,'Google/Chrome/Default');mkdirSync(dir,{recursive:true});database(join(dir,'Cookies'));const source=(await f.sources.discover()).browsers[0].profiles[0];expect((await f.sources.prepare(source.id)).cookies[0].value).toBe('plain source');expect(f.keychain).not.toHaveBeenCalled();
  });
  it('keeps empty profiles visible and does not follow a Network directory symlink into an unrelated source',async()=>{
    const f=fixture(),dir=join(f.root,'Google/Chrome/Default'),outside=join(f.root,'outside');mkdirSync(dir,{recursive:true});mkdirSync(outside);database(join(outside,'Cookies'));symlinkSync(outside,join(dir,'Network'));const list=await f.sources.discover(),source=list.browsers[0].profiles[0];expect(source.hasCookies).toBe(false);await expect(f.sources.prepare(source.id)).rejects.toMatchObject({reason:'source-missing'});expect(f.keychain).not.toHaveBeenCalled();
  });
});
describe.skipIf(process.platform!=='darwin')('native macOS Keychain command adapter (substituted child only)',()=>{
  it('uses exact public service/account args and the 30s budget, derives in memory and clears raw command buffers',async()=>{
    const stdout=Buffer.from('M12 synthetic keychain password\n'),stderr=Buffer.from('synthetic diagnostics');execute.mockImplementation((_file:string,_args:string[],_options:unknown,callback:(error:Error|null,out:Buffer,err:Buffer)=>void)=>{callback(null,stdout,stderr);});
    expect(await readMacBrowserCookieKey('chrome')).toEqual(expectedKey);expect(execute.mock.calls[0].slice(0,3)).toEqual(['/usr/bin/security',['find-generic-password','-s','Chrome Safe Storage','-a','Chrome','-w'],{encoding:'buffer',timeout:30000,maxBuffer:65536,windowsHide:true}]);expect(stdout.every(v=>v===0)).toBe(true);expect(stderr.every(v=>v===0)).toBe(true);expect(JSON.stringify(execute.mock.calls[0].slice(0,3))).not.toContain('M12 synthetic keychain password');
  });
  it('reports denial/timeout without forwarding command output or trying any target cookie write',async()=>{
    const stdout=Buffer.from('must not expose key'),stderr=Buffer.from('must not expose stderr');execute.mockImplementation((_file:string,_args:string[],_options:unknown,callback:(error:Error|null,out:Buffer,err:Buffer)=>void)=>callback(Error('denied with private detail'),stdout,stderr));await expect(readMacBrowserCookieKey('edge')).rejects.toMatchObject({reason:'keychain-denied'});expect(stdout.every(v=>v===0)&&stderr.every(v=>v===0)).toBe(true);
    execute.mockImplementation((_file:string,_args:string[],_options:unknown,callback:(error:Error|null,out:Buffer,err:Buffer)=>void)=>callback(Object.assign(Error('timeout private detail'),{killed:true}),Buffer.alloc(0),Buffer.alloc(0)));await expect(readMacBrowserCookieKey('edge')).rejects.toMatchObject({reason:'keychain-timeout'});
  });
});
