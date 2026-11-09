import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const ROOT='/private/tmp/willyou-m12-t130-native-remaining-prep-001/F17-native-I-001';
export const NODE='/Users/liubu/.hermes/node/bin/node';
export const BROKER='/private/tmp/willyou-m12-app026-installer-001/Installed Applications/WillYou.app/Contents/Resources/native/willyou-files';
export const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export const save=(leaf,value)=>fs.writeFileSync(path.join(ROOT,leaf),JSON.stringify(value,null,2)+'\n');
export function lease(cleanup=false){assert.equal(process.env.WILLYOU_M12_NATIVE_LEASE_CONFIRMED,'1');const l=json(path.join(ROOT,'lease.receipt.json'));assert.equal(l.status,'granted');assert.equal(l.privateRoot,ROOT);assert.equal(l.owner,'/root/t125_resume_ready');assert.equal(l.group,'M12-T130-F17-current-native-I001');assert.equal(l.executionReadySHA256,sha(path.join(ROOT,'READY.json')));if(!cleanup){assert(Date.parse(l.notBefore)<=Date.now());assert(Date.now()<Date.parse(l.expiresAt));}return l;}
export function verify(){const m=json(path.join(ROOT,'manifest.json'));for(const f of m.files){const p=path.isAbsolute(f.path)?f.path:path.join(ROOT,f.path);assert.equal(sha(p),f.sha256,p);assert.equal(fs.statSync(p).mode&0o777,f.mode,p);}for(const l of m.links){const p=path.join(ROOT,l.path);assert.equal(fs.readlinkSync(p),l.target,p);assert.equal(fs.realpathSync(p),l.realpath,p);}return {fileCount:m.files.length,linkCount:m.links.length,manifestSHA256:sha(path.join(ROOT,'manifest.json'))};}
export function fingerprints(){const oracle=json(path.join(ROOT,'fixture/fixtures.json'));return oracle.cases.map(({name})=>{const p=path.join(ROOT,'fixture/project',name),s=fs.statSync(p,{bigint:true});return{name,sha256:sha(p),bytes:String(s.size),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};});}
