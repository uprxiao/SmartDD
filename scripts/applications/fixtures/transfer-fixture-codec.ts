// Original strict v1 crypto for read-only acceptance assertions; no App injection.
export {decryptProject,encryptProject,validatePayload} from '../../../src/main/core/projects/transfer-format';
export {transferFixture} from '../../../src/main/core/projects/transfer-fixtures';
import {createCipheriv,randomBytes,scryptSync} from 'node:crypto';
// Adapted from transfer-format.test.ts authenticatedInvalidPayload: a sender can
// authenticate invalid fields. Only fixture production bypasses validation; the
// receiving original App still authenticates and validates its strict schema.
export function authenticatedInvalidPayloadFixture(json:string,password:string):Buffer {
 const kdf={name:'scrypt',N:131072,r:8,p:1,salt:randomBytes(16).toString('base64')},cipherHeader={name:'aes-256-gcm',nonce:randomBytes(12).toString('base64')},header={format:'willyou.project',version:1,kdf,cipher:cipherHeader};
 const key=scryptSync(password,Buffer.from(kdf.salt,'base64'),32,{N:kdf.N,r:kdf.r,p:kdf.p,maxmem:256*1024*1024});
 try{const cipher=createCipheriv('aes-256-gcm',key,Buffer.from(cipherHeader.nonce,'base64'));cipher.setAAD(Buffer.from(JSON.stringify(header)));const ciphertext=Buffer.concat([cipher.update(json),cipher.final()]).toString('base64');return Buffer.from(JSON.stringify({...header,cipher:{...cipherHeader,tag:cipher.getAuthTag().toString('base64')},ciphertext}));}finally{key.fill(0);}
}
