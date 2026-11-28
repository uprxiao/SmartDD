// Independent verification of the exact new synthetic artifact, with its own ephemeral test-only password.
// Never reads an external project, real credential, keychain, or raw secret into evidence.
import assert from 'node:assert/strict';
import {createDecipheriv,scrypt} from 'node:crypto';
const keys=(o,a)=>assert.deepEqual(Object.keys(o).sort(),[...a].sort());
const b64=(s,n)=>{const b=Buffer.from(s,'base64');assert.equal(b.toString('base64'),s);if(n!==undefined)assert.equal(b.length,n);return b;};
export async function verifyOwnEncryptedProject(raw,pass,projectName,projectDir){
 assert(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=16*1024*1024);assert(!raw.includes(Buffer.from(pass))&&!raw.includes(Buffer.from(projectName)));
 const h=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));keys(h,['format','version','kdf','cipher','ciphertext']);keys(h.kdf,['name','N','r','p','salt']);keys(h.cipher,['name','nonce','tag']);
 assert.equal(h.format,'willyou.project');assert.equal(h.version,1);assert.equal(h.kdf.name,'scrypt');assert.equal(h.kdf.N,131072);assert.equal(h.kdf.r,8);assert.equal(h.kdf.p,1);assert.equal(h.cipher.name,'aes-256-gcm');
 const salt=b64(h.kdf.salt,16),iv=b64(h.cipher.nonce,12),tag=b64(h.cipher.tag,16),cipher=b64(h.ciphertext);assert(cipher.length>0&&cipher.length<=10*1024*1024);
 const aad=Buffer.from(JSON.stringify({format:h.format,version:h.version,kdf:{name:'scrypt',N:131072,r:8,p:1,salt:h.kdf.salt},cipher:{name:'aes-256-gcm',nonce:h.cipher.nonce}}));
 const secret=Buffer.from(pass,'utf8');let key=null,partial=null,plain=null;
 try{key=await new Promise((ok,no)=>scrypt(secret,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024},(e,k)=>e?no(e):ok(k)));const dec=createDecipheriv('aes-256-gcm',key,iv);dec.setAAD(aad);dec.setAuthTag(tag);partial=dec.update(cipher);plain=Buffer.concat([partial,dec.final()]);const p=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(plain));keys(p,['schemaVersion','exportedAt','producer','project','directories','databases','servers','capabilities','profiles','credentials']);assert.equal(p.schemaVersion,1);assert.equal(p.project.name,projectName);assert(Array.isArray(p.directories)&&p.directories.some(x=>x.path===projectDir&&x.label==='fixture source'));assert.deepEqual(p.credentials,{});return{format:h.format,version:h.version,cipher:h.cipher.name,kdf:h.kdf.name,authenticated:true,exactSyntheticProject:true,directoryCount:p.directories.length,credentialCount:0,plaintextNotRetained:true};}finally{secret.fill(0);key?.fill(0);partial?.fill(0);plain?.fill(0);}
}
