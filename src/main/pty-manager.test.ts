import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PtyManager } from './pty-manager';
let manager:PtyManager,home:string;
beforeEach(()=>{manager=new PtyManager();home=mkdtempSync(join(tmpdir(),'willyou-m10-native-pty-'));mkdirSync(join(home,'work'));});
afterEach(async()=>{const ids=[...live];const exits=Promise.all(ids.map(id=>exit(id)));manager.killAll();await exits;live.clear();rmSync(home,{recursive:true,force:true});});
const live=new Set<string>();
function exit(id:string):Promise<void>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{manager.off('exit',done);reject(new Error('owned PTY exit timeout'));},5000);const done=(pid:string)=>{if(pid===id){clearTimeout(timer);manager.off('exit',done);live.delete(id);resolve();}};manager.on('exit',done);});}
function ready(id:string):Promise<number>{return new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>{manager.off('data',data);reject(new Error('owned PTY ready timeout'));},5000);const data=(key:string,bytes:string)=>{if(key!==id)return;text+=bytes;const match=/M10_NATIVE_PID:(\d+)/.exec(text);if(match){clearTimeout(timer);manager.off('data',data);resolve(Number(match[1]));}};manager.on('data',data);try{manager.spawn({id,command:process.execPath,args:['-e',"process.stdout.write('M10_NATIVE_PID:'+process.pid+'\\n');process.stdin.on('data',d=>{if(String(d).includes('PING'))process.stdout.write('M10_PONG\\n');});setInterval(()=>{},10000);"],cwd:join(home,'work'),env:{HOME:home,PATH:'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'}});live.add(id);}catch(error){clearTimeout(timer);manager.off('data',data);reject(error);}});}
describe.skipIf(process.platform!=='darwin')('owned native PTY identities',()=>{
  it('uses the host reserved ID and obtains the PID from the actual native handle; rejects reuse before another fork',async()=>{const id=randomUUID(),pid=await ready(id);expect(manager.nativePid(id)).toBe(pid);expect(()=>manager.spawn({id,command:process.execPath,args:[],cwd:home,env:{}})).toThrow('PTY_IDENTITY_CONFLICT');expect(manager.nativePid(id)).toBe(pid);const ended=exit(id);manager.kill(id);await ended;expect(manager.nativePid(id)).toBeNull();expect(manager.has(id)).toBe(false);});
  it('keeps another owned native PTY interactive when stopping one identity',async()=>{const a=randomUUID(),b=randomUUID();await ready(a);const secondPid=await ready(b),ended=exit(a);manager.kill(a);await ended;expect(manager.nativePid(b)).toBe(secondPid);await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{manager.off('data',data);reject(new Error('second native PTY response timeout'));},5000);const data=(id:string,bytes:string)=>{if(id===b&&bytes.includes('M10_PONG')){clearTimeout(timer);manager.off('data',data);resolve();}};manager.on('data',data);manager.writeControlled(b,'PING\n');});});
});
