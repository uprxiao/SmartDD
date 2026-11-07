// Original D05 two real64MiB image fixture, confined to this attempt's runtime/volumes.
import assert from'node:assert/strict';
import{execFile}from'node:child_process';import{promisify}from'node:util';import{createHash}from'node:crypto';
import{lstat,mkdir,readFile,readlink,realpath,stat,statfs,symlink,writeFile}from'node:fs/promises';import{join}from'node:path';
const exec=promisify(execFile),sha=x=>createHash('sha256').update(x).digest('hex');
export const caseVolumeBase=(slot,name)=>'BASE '+slot+' '+name+' 中文🙂\r\n';
export async function createCaseVolumeFixture({base,checkpoint}){
 assert(base==='/private/tmp/willyou-m12-t130-D05-App035-A-cont-002/runtime-001/volumes');await mkdir(base,{mode:0o700});
 const evidence={at:new Date().toISOString(),base,volumes:[],commands:[],cases:[],boundary:'Original readonly D05: own two64MiBAPFS/APFSX only; actual EEXIST/inode/bytes decide semantics, not labels. No system/user volume modification.'};let closed=false;
 const record=async()=>{await writeFile(join(base,'environment.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});await checkpoint(evidence);};
 async function command(args){const row={args,startedAt:new Date().toISOString()};evidence.commands.push(row);await record();try{const done=await exec(args[0],args.slice(1),{timeout:45000,maxBuffer:4*1024*1024});Object.assign(row,{code:0,stderr:done.stderr,finishedAt:new Date().toISOString()});await record();return done.stdout;}catch(error){Object.assign(row,{code:error.code,stderr:error.stderr,stack:String(error.stack??error),finishedAt:new Date().toISOString()});await record();throw error;}}
 async function close(){if(closed)return;for(const v of[...evidence.volumes].reverse()){if(v.detached)continue;assert.equal((await stat(v.mount)).dev,v.mountedDevice,'Refusing different mounted device');await command(['/usr/bin/hdiutil','detach',v.device]);v.detached=true;await record();}closed=true;evidence.finishedAt=new Date().toISOString();await record();}
 try{
  for(const[kind,format,sensitive]of[['insensitive','APFS',false],['sensitive','Case-sensitive APFS',true]]){
   const mount=join(base,kind),image=join(base,kind+'.dmg');await mkdir(mount,{mode:0o700});await command(['/usr/bin/hdiutil','create','-size','64m','-fs',format,'-volname','WillYou-D05-'+kind,'-type','UDIF',image]);
   const attach=join(base,kind+'-attach.plist');await writeFile(attach,await command(['/usr/bin/hdiutil','attach','-nobrowse','-noautoopen','-mountpoint',mount,'-plist',image]),{mode:0o600});
   const plist=JSON.parse(await command(['/usr/bin/python3','-c','import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))',attach]));const device=plist['system-entities'].find(x=>x['mount-point']===mount)?.['dev-entry'];assert(device&&/^\/dev\/disk\d+s\d+$/.test(device));
   const mountedDevice=(await stat(mount)).dev,v={kind,format,sensitive,mount,image,device,mountedDevice,detached:false};evidence.volumes.push(v);await record();assert.notEqual(mountedDevice,(await stat(base)).dev);const size=await statfs(mount);v.capacityBytes=size.blocks*size.bsize;assert(v.capacityBytes<=80*1024*1024);
   await writeFile(join(mount,'A.txt'),'probe upper',{flag:'wx'});let lowerCreate='created';try{await writeFile(join(mount,'a.txt'),'probe lower',{flag:'wx'});}catch(error){lowerCreate=error.code;assert.equal(error.code,'EEXIST');}
   const a=await stat(join(mount,'A.txt'),{bigint:true}),b=await stat(join(mount,'a.txt'),{bigint:true});assert.equal(lowerCreate==='created',sensitive);assert.equal(a.ino!==b.ino,sensitive);v.actualProbe={lowerCreate,upperInode:String(a.ino),lowerInode:String(b.ino),upperHash:sha(await readFile(join(mount,'A.txt'))),lowerHash:sha(await readFile(join(mount,'a.txt')))};
   await writeFile(join(base,kind+'-info.plist'),await command(['/usr/sbin/diskutil','info','-plist',mount]),{mode:0o600});await record();
  }
  async function prepare(kind,slot){assert(/^[a-z0-9-]+$/.test(slot));const v=evidence.volumes.find(x=>x.kind===kind);assert(v&&!v.detached);const root=join(v.mount,slot),inner=join(root,'inner'),alias=join(base,kind+'-'+slot+'-root-alias');await mkdir(root);await mkdir(inner);await writeFile(join(root,'A.txt'),caseVolumeBase(slot,'A'),{flag:'wx',mode:0o600});if(v.sensitive)await writeFile(join(root,'a.txt'),caseVolumeBase(slot,'a'),{flag:'wx',mode:0o600});await writeFile(join(inner,'data.txt'),caseVolumeBase(slot,'data'),{flag:'wx',mode:0o600});await symlink('inner/data.txt',join(root,'link.txt'));await symlink('inner',join(root,'link-dir'));await symlink(root,alias);assert((await lstat(alias)).isSymbolicLink());assert.equal(await readlink(alias),root);assert.equal(await realpath(alias),await realpath(root));const paths={kind,slot,sensitive:v.sensitive,root,inner,alias};evidence.cases.push(paths);await record();return paths;}
  return{base,evidence,prepare,close};
 }catch(error){evidence.error=String(error.stack??error);try{await close();}catch(cleanup){evidence.cleanupError=String(cleanup.stack??cleanup);}await record();throw error;}
}
