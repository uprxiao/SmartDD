import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EmbeddedNodeRuntime} from '../embedded-node-runtime';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function executable(body:string){
 const root=mkdtempSync(join(tmpdir(),'willyou-m10-node-probe-'));roots.push(root);
 const path=join(root,'probe'),pidPath=join(root,'pid');
 writeFileSync(path,'#!/bin/sh\nprintf "%s" "$$" > '+"'"+pidPath+"'"+'\n'+body+'\n',{mode:0o700});
 return{path,pidPath};
}
const signal=()=>new AbortController().signal;
function absent(pidPath:string){const pid=Number(readFileSync(pidPath,'utf8'));expect(()=>process.kill(pid,0)).toThrow();}
describe('current executable embedded Node readiness',()=>{
 it('verifies the actual current Node runtime without PATH or inherited Node options',async()=>{
  expect(await new EmbeddedNodeRuntime().check(signal())).toBe(true);
 });
 it.each(['exit 1','printf "invalid"','/usr/bin/head -c 8192 /dev/zero'])('rejects %s and waits for its own process exit',async body=>{
  const x=executable(body);expect(await new EmbeddedNodeRuntime({executable:x.path}).check(signal())).toBe(false);absent(x.pidPath);
 });
 it('bounds a stalled probe, kills only its owned child, and retries a prior failure',async()=>{
  const x=executable('exec /bin/sleep 30'),probe=new EmbeddedNodeRuntime({executable:x.path,timeoutMs:1000});
  expect(await probe.check(signal())).toBe(false);absent(x.pidPath);
  writeFileSync(x.path,'#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' "$@"\n',{mode:0o700});
  expect(await probe.check(signal())).toBe(true);
 });
 it('cancels an active probe and reaps its physical child before rejecting',async()=>{
  const x=executable('exec /bin/sleep 30'),abort=new AbortController(),work=new EmbeddedNodeRuntime({executable:x.path}).check(abort.signal);
  const outcome=work.then(()=>null,error=>error);
  await vi.waitFor(()=>expect(existsSync(x.pidPath)).toBe(true));
  abort.abort();expect(await outcome).toMatchObject({code:'CANCELED'});absent(x.pidPath);
 });
 it('does not execute an already canceled probe or accept a missing executable',async()=>{
  const x=executable('exit 0'),abort=new AbortController();abort.abort();
  await expect(new EmbeddedNodeRuntime({executable:x.path}).check(abort.signal)).rejects.toMatchObject({code:'CANCELED'});
  expect(existsSync(x.pidPath)).toBe(false);
  expect(await new EmbeddedNodeRuntime({executable:join(x.path,'absent')}).check(signal())).toBe(false);
 });
});
