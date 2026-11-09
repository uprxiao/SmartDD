import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCipheriv,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {BrowserCookieSourceError,decryptMacChromiumCookie,deriveMacChromiumCookieKey,snapshotChromiumCookies} from '../cookie-import/chromium-source';
import {readChromiumCookies} from '../cookie-import/source-rows';
const roots:string[]=[],databases:Database.Database[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const password=Buffer.from('M12 synthetic keychain password'),key=Buffer.from('67c27378db32f53bc054d194222da644','hex');
function encrypted(value:string,host='.qa.example.test',version=24){const cipher=createCipheriv('aes-128-cbc',key,Buffer.alloc(16,0x20)),plain=Buffer.concat([...(version>=24?[createHash('sha256').update(host).digest()]:[]),Buffer.from(value)]);return Buffer.concat([Buffer.from('v10'),cipher.update(plain),cipher.final()]);}
function fixture(version=24){
  const root=mkdtempSync(join(tmpdir(),'willyou-m12-source-')),path=join(root,'Cookies'),db=new Database(path);roots.push(root);databases.push(db);db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');
  db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE cookies(host_key TEXT,name TEXT,value TEXT,encrypted_value BLOB,path TEXT,is_secure INTEGER,is_httponly INTEGER,expires_utc INTEGER,samesite INTEGER,has_expires INTEGER,top_frame_site_key TEXT,has_cross_site_ancestor INTEGER)');db.prepare('INSERT INTO meta VALUES(?,?)').run('version',String(version));
  const add=(overrides:Partial<{domain:string;name:string;value:string;encrypted:Buffer;path:string;secure:number;httpOnly:number;expires:bigint;site:number;hasExpires:number;top:string;ancestor:number}>={})=>{const v={domain:'.qa.example.test',name:'X',value:'',encrypted:encrypted('new X'),path:'/',secure:1,httpOnly:1,expires:0n,site:1,hasExpires:0,top:'',ancestor:0,...overrides};db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(v.domain,v.name,v.value,v.encrypted,v.path,v.secure,v.httpOnly,v.expires,v.site,v.hasExpires,v.top,v.ancestor);};
  return{root,path,db,add};
}
describe('macOS Chromium source preflight (software, synthetic databases)',()=>{
  it('uses the independently fixed PBKDF2 vector and verifies exact schema-24 host hashes, including empty values',()=>{
    expect(deriveMacChromiumCookieKey(password)).toEqual(key);expect(decryptMacChromiumCookie({encrypted:encrypted('订单 token'),key,hostKey:'.qa.example.test',version:24})).toBe('订单 token');expect(decryptMacChromiumCookie({encrypted:encrypted(''),key,hostKey:'.qa.example.test',version:24})).toBe('');
    expect(()=>decryptMacChromiumCookie({encrypted:encrypted('secret'),key,hostKey:'qa.example.test',version:24})).toThrow('无法解密');expect(()=>decryptMacChromiumCookie({encrypted:encrypted('secret'),key:Buffer.alloc(16),hostKey:'.qa.example.test',version:24})).toThrow('无法解密');
    const appBound=encrypted('secret');appBound.write('v20');expect(()=>decryptMacChromiumCookie({encrypted:appBound,key,hostKey:'.qa.example.test',version:24})).toThrow('无法解密');
    expect(decryptMacChromiumCookie({encrypted:encrypted('legacy value','.qa.example.test',23),key,hostKey:'.qa.example.test',version:23})).toBe('legacy value');
  });
  it('copies WAL-only commits consistently, leaves source bytes intact and cleans only its private snapshot',async()=>{
    const f=fixture();f.add();const before=[readFileSync(f.path),readFileSync(f.path+'-wal')],snapshot=await snapshotChromiumCookies(f.path,f.root);expect(statSync(dirname(snapshot.path)).mode&0o777).toBe(0o700);expect(statSync(snapshot.path).mode&0o777).toBe(0o600);
    const copy=new Database(snapshot.path,{readonly:true});try{expect(copy.prepare('SELECT count(*) n FROM cookies').get()).toEqual({n:1});}finally{copy.close();}
    expect(readFileSync(f.path)).toEqual(before[0]);expect(readFileSync(f.path+'-wal')).toEqual(before[1]);await snapshot.cleanup();expect(readdirSync(f.root).filter(n=>n.startsWith('willyou-cookie-source-'))).toEqual([]);expect(f.db.prepare('SELECT count(*) n FROM cookies').get()).toEqual({n:1});
  });
  it('prepares all normal rows, preserves all properties and exact large Chromium timestamps, and erases the one-use key',async()=>{
    const f=fixture();f.add();f.add({name:'W',encrypted:encrypted('new W'),path:'/private',site:0,hasExpires:1,expires:13644473600123456n});f.add({name:'host',domain:'host.example.test',encrypted:Buffer.alloc(0),value:'plain',httpOnly:0});const owned=Buffer.from(key),getKey=vi.fn(async()=>owned);
    const result=await readChromiumCookies({databasePath:f.path,temporaryRoot:f.root,getKey});expect(getKey).toHaveBeenCalledOnce();expect(owned.every(v=>v===0)).toBe(true);expect(result.sourceCount).toBe(3);expect(result.cookies[0]).toMatchObject({name:'X',value:'new X',domain:'.qa.example.test',secure:true,httpOnly:true,hostOnly:false,expirationDate:null});expect(result.cookies[1]).toMatchObject({name:'W',value:'new W',path:'/private',sameSite:'no_restriction',expirationDate:2000000000.123456});expect(result.cookies[2]).toMatchObject({hostOnly:true,value:'plain',httpOnly:false});expect(readdirSync(f.root).filter(n=>n.startsWith('willyou-cookie-source-'))).toEqual([]);
  });
  it('excludes Google before decryption, keeps YouTube and readable partitions, and flags opaque identities for family preservation',async()=>{
    const f=fixture();f.add({domain:'.google.com',encrypted:Buffer.from('undecryptable Google')});f.add({domain:'.youtube.com',name:'SIDCC',encrypted:Buffer.alloc(0),value:'youtube allowed'});f.add({domain:'.chips.test',encrypted:Buffer.alloc(0),value:'partitioned',top:'https://top.example.test/',ancestor:1});f.add({domain:'.preserve.test',encrypted:Buffer.from('must not decrypt unknown partition'),top:'opaque',ancestor:1});const getKey=vi.fn(async()=>Buffer.from(key));
    const result=await readChromiumCookies({databasePath:f.path,temporaryRoot:f.root,getKey});expect(getKey).not.toHaveBeenCalled();expect(result).toMatchObject({sourceCount:4,googleSkipped:1,partitionSkipped:1,preserveDomains:['preserve.test']});expect(result.cookies.map(c=>c.domain)).toEqual(['.youtube.com','.chips.test']);expect(result.cookies[1].partitionKey).toEqual({topLevelSite:'https://top.example.test',hasCrossSiteAncestor:true});
  });
  it('rejects the whole preparation on a later wrong-key/host row instead of falling back to plaintext or returning a partial list',async()=>{
    const f=fixture();f.add();f.add({name:'bad',value:'do-not-fallback',encrypted:encrypted('different host','.other.example.test')});const owned=Buffer.from(key);
    await expect(readChromiumCookies({databasePath:f.path,temporaryRoot:f.root,getKey:async()=>owned})).rejects.toMatchObject({reason:'cookies-undecryptable'});expect(owned.every(v=>v===0)).toBe(true);expect(f.db.prepare('SELECT count(*) n FROM cookies').get()).toEqual({n:2});expect(readdirSync(f.root).filter(n=>n.startsWith('willyou-cookie-source-'))).toEqual([]);
  });
  it('preserves explicit keychain failure reasons and rejects invalid native fields before returning any prepared cookies',async()=>{
    const f=fixture();f.add();await expect(readChromiumCookies({databasePath:f.path,temporaryRoot:f.root,getKey:async()=>{throw new BrowserCookieSourceError('keychain-denied','钥匙串授权被拒绝');}})).rejects.toMatchObject({reason:'keychain-denied'});
    f.db.prepare('DELETE FROM cookies').run();f.add({name:'bad;name',encrypted:Buffer.alloc(0),value:'plain'});await expect(readChromiumCookies({databasePath:f.path,temporaryRoot:f.root,getKey:async()=>Buffer.from(key)})).rejects.toMatchObject({reason:'source-unreadable'});
  });
  it('rejects missing and symlink sources and removes incomplete private copies',async()=>{
    const f=fixture();await expect(snapshotChromiumCookies(join(f.root,'absent'),f.root)).rejects.toMatchObject({reason:'source-missing'});const link=join(f.root,'linked');symlinkSync(f.path,link);await expect(snapshotChromiumCookies(link,f.root)).rejects.toMatchObject({reason:'source-unreadable'});expect(readdirSync(f.root).filter(n=>n.startsWith('willyou-cookie-source-'))).toEqual([]);writeFileSync(join(f.root,'keep'),'untouched');expect(readFileSync(join(f.root,'keep'),'utf8')).toBe('untouched');
  });
});
