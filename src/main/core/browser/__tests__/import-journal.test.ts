import {afterEach,describe,expect,it} from 'vitest';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,statSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {SecretCipher} from '../../../secrets';
import {BrowserImportJournals,browserImportJournalSchema,type BrowserImportCookie,type BrowserImportJournal} from '../cookie-import/journal';

const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'willyou-m12-import-journal-')),key=randomBytes(32);roots.push(root);let available=true;
  // Real authenticated encryption of synthetic data, substituting only the OS
  // Keychain-backed cipher. This software proof does not claim safeStorage A.
  const cipher:SecretCipher={isAvailable:()=>available,encrypt:text=>{const nonce=randomBytes(12),encrypt=createCipheriv('aes-256-gcm',key,nonce),payload=Buffer.concat([encrypt.update(text,'utf8'),encrypt.final()]);return Buffer.concat([nonce,encrypt.getAuthTag(),payload]);},decrypt:bytes=>{const decrypt=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12),{authTagLength:16});decrypt.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decrypt.update(bytes.subarray(28)),decrypt.final()]).toString('utf8');}};
  const store=new BrowserImportJournals(root,cipher),profileId='11111111-1111-4111-8111-111111111111';
  const cookie:BrowserImportCookie={name:'session',value:'synthetic-before-token',domain:'.example.test',path:'/',secure:true,httpOnly:true,hostOnly:false,sameSite:'lax',expirationDate:null,partitionKey:null};
  const journal:BrowserImportJournal={schemaVersion:1,transactionId:randomUUID(),profileId,createdAt:1,changes:[{before:cookie,after:{...cookie,value:'synthetic-after-token'}},{before:null,after:{...cookie,name:'new-only',value:'synthetic-new-token'}},{before:{...cookie,name:'removed-only'},after:null}]};
  return{root,cipher,store,journal,cookie,setAvailable:(value:boolean)=>{available=value;}};
}
describe('encrypted Cookie import recovery journals (software only)',()=>{
  it('preserves the complete before/after set including absent originals without putting tokens in disk plaintext',()=>{
    const f=fixture();f.journal.changes[0].before={...f.cookie,priority:'High',sourceScheme:'Secure',sourcePort:443};f.store.write(f.journal);const path=f.store.path(f.journal.profileId),disk=readFileSync(path);for(const secret of ['synthetic-before-token','synthetic-after-token','synthetic-new-token'])expect(disk.includes(Buffer.from(secret))).toBe(false);
    expect(statSync(path).mode&0o777).toBe(0o600);expect(statSync(f.store.directory).mode&0o777).toBe(0o700);expect(readdirSync(f.store.directory)).toEqual([f.journal.profileId+'.bin']);
    const restart=new BrowserImportJournals(f.root,f.cipher);expect(restart.pending()).toEqual([f.journal.profileId]);expect(restart.read(f.journal.profileId)).toEqual(f.journal);
  });
  it('retains distinct readable partition identities and rejects duplicate or mismatched change coordinates before a file is written',()=>{
    const f=fixture(),a={...f.cookie,partitionKey:{topLevelSite:'https://one.test',hasCrossSiteAncestor:true}},b={...f.cookie,partitionKey:{topLevelSite:'https://two.test',hasCrossSiteAncestor:true}};
    const partitioned={...f.journal,changes:[{before:a,after:{...a,value:'after'}},{before:null,after:b}]};expect(browserImportJournalSchema.parse(partitioned)).toEqual(partitioned);
    expect(()=>f.store.write({...f.journal,changes:[...f.journal.changes,f.journal.changes[0]]})).toThrow('变更集无效');expect(()=>f.store.write({...f.journal,changes:[{before:f.cookie,after:{...f.cookie,path:'/changed'}}]})).toThrow('变更集无效');expect(f.store.pending()).toEqual([]);
  });
  it('refuses to overwrite an outstanding recovery transaction or remove it with a stale transaction id',()=>{
    const f=fixture();f.store.write(f.journal);const original=readFileSync(f.store.path(f.journal.profileId));expect(()=>f.store.write({...f.journal,transactionId:randomUUID()})).toThrow('请先处理');expect(()=>f.store.remove(f.journal.profileId,randomUUID())).toThrow('未删除');expect(readFileSync(f.store.path(f.journal.profileId))).toEqual(original);f.store.remove(f.journal.profileId,f.journal.transactionId);expect(f.store.pending()).toEqual([]);expect(f.store.read(f.journal.profileId)).toBeNull();
  });
  it('does not create plaintext or replace an existing encrypted journal when OS encryption is unavailable',()=>{
    const f=fixture();f.setAvailable(false);expect(()=>f.store.write(f.journal)).toThrow('系统加密存储不可用');expect(f.store.pending()).toEqual([]);f.setAvailable(true);f.store.write(f.journal);const original=readFileSync(f.store.path(f.journal.profileId));f.setAvailable(false);expect(()=>f.store.read(f.journal.profileId)).toThrow('系统加密存储不可用');expect(readFileSync(f.store.path(f.journal.profileId))).toEqual(original);
  });
  it('retains corrupt ciphertext and refuses a decrypted journal bound to another profile',()=>{
    const f=fixture();f.store.write(f.journal);const file=f.store.path(f.journal.profileId);writeFileSync(file,Buffer.from('corrupt encrypted journal'));expect(()=>f.store.read(f.journal.profileId)).toThrow('原文件已保留');expect(readFileSync(file).toString()).toBe('corrupt encrypted journal');
    const wrong={...f.journal,profileId:'22222222-2222-4222-8222-222222222222'};writeFileSync(file,f.cipher.encrypt(JSON.stringify(wrong)));expect(()=>f.store.read(f.journal.profileId)).toThrow('原文件已保留');
  });
  it('rejects path traversal and journal directory symlinks without touching the outside directory',()=>{
    const f=fixture();expect(()=>f.store.path('../outside')).toThrow('标识无效');f.store.pending();rmSync(f.store.directory,{recursive:true});const outside=mkdtempSync(join(tmpdir(),'willyou-m12-journal-outside-'));roots.push(outside);writeFileSync(join(outside,'keep'),'untouched');symlinkSync(outside,f.store.directory);expect(()=>f.store.write(f.journal)).toThrow('目录不可用');expect(readdirSync(outside)).toEqual(['keep']);
  });
  it('refuses existing and broken journal symlinks without reading or replacing their targets',()=>{
    const f=fixture();f.store.pending();const outside=join(f.root,'outside.bin');writeFileSync(outside,'outside bytes');const file=f.store.path(f.journal.profileId);symlinkSync(outside,file);expect(()=>f.store.read(f.journal.profileId)).toThrow('文件类型无效');expect(()=>f.store.write(f.journal)).toThrow('文件类型无效');expect(readFileSync(outside).toString()).toBe('outside bytes');rmSync(file);symlinkSync(join(f.root,'absent.bin'),file);expect(()=>f.store.read(f.journal.profileId)).toThrow('文件类型无效');expect(()=>f.store.write(f.journal)).toThrow('文件类型无效');
  });
});
