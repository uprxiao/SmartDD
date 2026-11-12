import {createServer,type Server} from 'node:net';
import {chmodSync,existsSync,mkdirSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {PrivateAgentEndpoint} from '../private-agent-endpoint';
import {codexDaemonRootPath} from '../agent-control-path';
import {digest} from '../manifest';
const endpoints:PrivateAgentEndpoint[]=[],servers:Server[]=[],physical:string[]=[];
const endpoint=()=>{const e=new PrivateAgentEndpoint({runId:randomUUID(),storeId:randomUUID()});endpoints.push(e);return e;};
const listen=async(path:string)=>{const server=createServer(socket=>socket.end());servers.push(server);await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(path,done);});chmodSync(path,0o600);return server;};
const close=(s:Server)=>new Promise<void>(done=>s.close(()=>done()));
afterEach(async()=>{
  for(const s of servers.splice(0))await close(s);
  for(const e of endpoints.splice(0)){chmodSync(e.directory,0o700);rmSync(e.directory,{recursive:true,force:true});}
  for(const path of physical.splice(0))rmSync(path,{force:true});
});
describe.skipIf(process.platform!=='darwin')('marked per-run endpoint and exact Codex rendezvous mapping',()=>{
  it('creates a private unique endpoint without native config or credentials and removes an untouched no-fork directory',()=>{
    const e=endpoint(),other=endpoint();expect(e.path).not.toBe(other.path);expect(Buffer.byteLength(e.path)).toBeLessThan(100);expect(JSON.parse(readFileSync(join(e.directory,'owner.json'),'utf8')).schema).toBe('willyou-private-agent-endpoint-v1');e.release();expect(existsSync(e.directory)).toBe(false);endpoints.splice(endpoints.indexOf(e),1);
  });
  it('accepts only the own-path SHA256 alias under the canonical per-user Codex physical directory',async()=>{
    const e=endpoint(),base=codexDaemonRootPath();mkdirSync(base,{recursive:true,mode:0o700});const path=join(base,digest(e.path));physical.push(path);const s=await listen(path);symlinkSync(path,e.path);e.verifySocket();expect(e.socketObservations[0]).toMatchObject({type:'link',target:path});await close(s);e.release();endpoints.splice(endpoints.indexOf(e),1);expect(existsSync(e.directory)).toBe(false);
  });
  it('rejects an arbitrary same-user symlink even when it points to a real socket',async()=>{
    const e=endpoint(),other=endpoint();await listen(other.path);symlinkSync(other.path,e.path);expect(()=>e.verifySocket()).toThrow();expect(()=>e.release()).toThrow();expect(existsSync(other.path)).toBe(true);
  });
  it('refuses a changed physical inode and preserves the replacement socket',async()=>{
    const e=endpoint(),base=codexDaemonRootPath();mkdirSync(base,{recursive:true,mode:0o700});const path=join(base,digest(e.path));physical.push(path);const first=await listen(path);symlinkSync(path,e.path);e.verifySocket();await close(first);await listen(path);expect(()=>e.verifySocket()).toThrow();expect(()=>e.release()).toThrow();expect(existsSync(path)).toBe(true);
  });
  it('refuses alias retargeting, changed marker and unexpected files instead of recursive cleanup',async()=>{
    const e=endpoint();await listen(e.path);e.verifySocket();unlinkSync(e.path);const other=endpoint();await listen(other.path);symlinkSync(other.path,e.path);expect(()=>e.release()).toThrow();writeFileSync(join(other.directory,'owner.json'),'changed');expect(()=>other.release()).toThrow();expect(existsSync(e.directory)).toBe(true);
  });
  it('preserves a changed dangling physical symlink rather than confusing it with an absent original socket',async()=>{
    const e=endpoint(),base=codexDaemonRootPath();mkdirSync(base,{recursive:true,mode:0o700});const path=join(base,digest(e.path));physical.push(path);const first=await listen(path);symlinkSync(path,e.path);e.verifySocket();await close(first);symlinkSync(join(e.directory,'absent'),path);expect(()=>e.release()).toThrow();expect(readFileSync(join(e.directory,'owner.json'),'utf8')).toContain('willyou-private-agent-endpoint-v1');
  });
});
