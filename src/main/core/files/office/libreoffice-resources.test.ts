import { beforeAll,afterAll,afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,unlinkSync,chmodSync,realpathSync,renameSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { libreOfficeResources } from './libreoffice-resources';

const signer=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:(...args:unknown[])=>signer.verify(...args)}));
const io=vi.hoisted(()=>({onOpen:undefined as undefined|((path:string,handle:import('node:fs/promises').FileHandle)=>void)}));
vi.mock('node:fs/promises',async original=>{
  const actual=await original<typeof import('node:fs/promises')>();
  return {...actual,open:async(...args:Parameters<typeof actual.open>)=>{const handle=await actual.open(...args);io.onOpen?.(String(args[0]),handle);return handle;}};
});
const hash=(data:string)=>createHash('sha256').update(data).digest('hex');
let work:string,root:string,app:string;
const required=['Contents/MacOS/soffice','Contents/Info.plist','Contents/Frameworks/libmergedlo.dylib','Contents/Resources/fundamentalrc','Contents/Resources/registry/main.xcd','Contents/Resources/LICENSE','Contents/Resources/LICENSE.html','Contents/Resources/NOTICE'];
const files:Array<{path:string;bytes:number;sha256:string}|{path:string;link:string}>=[];
const arch=process.arch==='arm64' ? 'arm64' : 'x64';
const source=arch==='arm64' ? {bytes:295019039,sha256:'64e0ad05564554eeee639d49b08b20908a38d4722ec95f1620d05c99bcbe9fb1',url:'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.4.2/mac/aarch64/LibreOffice_26.2.4.2_MacOS_aarch64.dmg'} : {bytes:305573151,sha256:'f92ba40fdada173232fe929bf77973a1ffcccec55ae7971957a6de84d33f0f1e',url:'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.4.2/mac/x86_64/LibreOffice_26.2.4.2_MacOS_x86-64.dmg'};
const manifest=()=>({schema:1,component:'willyou-office-libreoffice',platform:'darwin',arch,version:'26.2.4.2',build:'0229ac93fcf0d7cbc6376066c6f35021cef002dc',runtimeVersion:'LibreOffice 26.2.4.2 0229ac93fcf0d7cbc6376066c6f35021cef002dc',source,totalBytes:9999*7,files});
const writeManifest=(value:unknown=manifest())=>writeFileSync(join(root,'resources.json'),JSON.stringify(value));
function observeHandles(onOpen?:(path:string,handle:import('node:fs/promises').FileHandle)=>void){
  let active=0,peak=0,opened=0;const invalidClosed:number[]=[],closedPaths:string[]=[],prefix=realpathSync(app)+'/';
  io.onOpen=(path,handle)=>{
    if(!path.startsWith(prefix))return;
    active++;opened++;peak=Math.max(peak,active);const close=handle.close.bind(handle);let closed=false;
    handle.close=async()=>{try{return await close();}finally{if(!closed){closed=true;active--;closedPaths.push(path);if(handle.fd!==-1)invalidClosed.push(handle.fd);}}};
    onOpen?.(path,handle);
  };
  return{get active(){return active},get peak(){return peak},get opened(){return opened},invalidClosed,closedPaths};
}
describe.skipIf(process.platform!=='darwin')('fixed LibreOffice resource verification (codesign boundary isolated)',()=>{
  beforeAll(()=>{
    work=mkdtempSync(join(tmpdir(),'willyou-lo-resource-test-'));root=join(work,'resources');app=join(root,'LibreOffice.app');mkdirSync(app,{recursive:true});
    const paths=[...required,...Array.from({length:9999-required.length},(_,index)=>`Contents/Resources/data/${index}`)];
    for(const path of paths){mkdirSync(dirname(join(app,path)),{recursive:true});writeFileSync(join(app,path),'fixture');files.push({path,bytes:7,sha256:hash('fixture')});}
    const link={path:'Contents/Resources/runtime-link',link:'../Frameworks/libmergedlo.dylib'};symlinkSync(link.link,join(app,link.path));files.push(link);writeManifest();
  },15000);
  afterAll(()=>rmSync(work,{recursive:true,force:true}));
  beforeEach(()=>{writeManifest();signer.verify.mockReset().mockImplementation((_command,_args,_options,callback)=>{callback(null,'','');});});
  afterEach(()=>{io.onOpen=undefined;});
  it('parallel verification overlaps actual reads within a fixed handle budget and returns the original manifest order',async()=>{
    const handles=observeHandles();
    const result=await libreOfficeResources(root);
    expect(handles.peak).toBeGreaterThan(1);expect(handles.peak).toBeLessThanOrEqual(8);expect(handles.active).toBe(0);expect(handles.invalidClosed).toEqual([]);
    expect(handles.opened).toBe(9999);expect(result.files.slice(1).map(file=>file.path)).toEqual(files.filter(file=>'bytes'in file).map(file=>'LibreOffice.app/'+file.path));
    expect(result.links).toEqual([{path:'LibreOffice.app/Contents/Resources/runtime-link',target:'../Frameworks/libmergedlo.dylib'}]);expect(result.bytes).toBe(9999*7);
  },20000);
  it.each(['checksum','cancellation'] as const)('parallel %s stops new work and drains an already opened peer before rejecting',async mode=>{
    const bad=realpathSync(join(app,required[0])),blocked=realpathSync(join(app,required[1])),abort=new AbortController();
    let release!:()=>void,arrive!:()=>void,entered=false,completed=false;const gate=new Promise<void>(r=>release=r),arrival=new Promise<void>(r=>arrive=r);
    if(mode==='checksum')writeFileSync(bad,'corrupt');
    const handles=observeHandles((path,handle)=>{
      const stat=handle.stat.bind(handle);let first=true;
      if(path===blocked)handle.stat=(async(...args:Parameters<typeof handle.stat>)=>{if(first){first=false;entered=true;arrive();await gate;}return stat(...args);}) as typeof handle.stat;
      else if(path===bad&&mode==='checksum')handle.stat=(async(...args:Parameters<typeof handle.stat>)=>{await arrival;return stat(...args);}) as typeof handle.stat;
    });
    const pending=libreOfficeResources(root,undefined,abort.signal).then(value=>{completed=true;return{value,error:undefined};},error=>{completed=true;return{value:undefined,error};});
    try{
      await vi.waitFor(()=>expect(entered).toBe(true),{timeout:5000});
      if(mode==='cancellation')abort.abort(new Error('cancel while verification reads are active'));
      else await vi.waitFor(()=>expect(handles.closedPaths).toContain(bad),{timeout:5000});
      expect(completed).toBe(false);expect(handles.active).toBeGreaterThan(0);const openedAtFailure=handles.opened;release();
      const result=await pending;expect(String(result.error)).toContain(mode==='checksum'?'资源校验失败':'cancel while verification');expect(result.value).toBeUndefined();
      expect(handles.active).toBe(0);expect(handles.invalidClosed).toEqual([]);expect(handles.peak).toBeLessThanOrEqual(8);expect(handles.opened).toBeLessThanOrEqual(openedAtFailure+8);
    }finally{release();await pending;if(mode==='checksum')writeFileSync(bad,'fixture');}
  },20000);
  it('parallel verification rejects a file replaced during its real read and closes all peer handles',async()=>{
    const target=realpathSync(join(app,required[0])),backup=join(work,'original-open-file');let replaced=false;
    const handles=observeHandles((path,handle)=>{
      if(path!==target)return;const stream=handle.createReadStream.bind(handle);
      handle.createReadStream=(...args)=>{renameSync(target,backup);writeFileSync(target,'fixture');replaced=true;return stream(...args);};
    });
    try{await expect(libreOfficeResources(root)).rejects.toThrow('校验时改变');expect(replaced).toBe(true);expect(handles.active).toBe(0);expect(handles.invalidClosed).toEqual([]);expect(handles.peak).toBeLessThanOrEqual(8);}
    finally{if(replaced){unlinkSync(target);renameSync(backup,target);}}
  },20000);
  it('parallel verification repeats every hash on a later call instead of caching a previous success',async()=>{
    await libreOfficeResources(root);
    // Use the last declared regular entry rather than assuming a generated name.
    const entry=files.filter(file=>'bytes'in file).at(-1)!,path=join(app,entry.path);writeFileSync(path,'corrupt');
    const handles=observeHandles();
    try{await expect(libreOfficeResources(root)).rejects.toThrow('资源校验失败');expect(handles.opened).toBe(9999);expect(handles.active).toBe(0);expect(handles.invalidClosed).toEqual([]);}
    finally{writeFileSync(path,'fixture');}
  },30000);
  it('returns every actual file identity/hash and contained link only after vendor signature verification',async()=>{
    const result=await libreOfficeResources(root);
    expect(result.files).toHaveLength(10000);expect(result.links).toEqual([{path:'LibreOffice.app/Contents/Resources/runtime-link',target:'../Frameworks/libmergedlo.dylib'}]);
    expect(result.bytes).toBe(9999*7);expect(result.files.every(file=>file.identity.inode && file.hash.length===64)).toBe(true);
    expect(signer.verify.mock.calls[0][1]).toContain('=anchor apple generic and identifier "org.libreoffice.script" and certificate leaf[subject.OU] = "7P5S3ZLCN7"');
  },20000);
  it('rejects another download, duplicate parts, incomplete manifests and escaping paths',async()=>{
    writeManifest({...manifest(),source:{...source,url:'https://example.invalid/lo.dmg'}});await expect(libreOfficeResources(root)).rejects.toThrow('来源');
    writeManifest({...manifest(),files:[...files.slice(1),files[1]]});await expect(libreOfficeResources(root)).rejects.toThrow('重复');
    writeManifest({...manifest(),files:files.slice(0,8)});await expect(libreOfficeResources(root)).rejects.toThrow('清单');
    writeManifest({...manifest(),files:[{...files[0],path:'../outside'},...files.slice(1)]});await expect(libreOfficeResources(root)).rejects.toThrow('清单');
    expect(signer.verify).not.toHaveBeenCalled();
  });
  it('rejects a symlinked component root before verification',async()=>{
    const link=join(work,'linked-root');symlinkSync(root,link);
    try {await expect(libreOfficeResources(link)).rejects.toThrow('链接');expect(signer.verify).not.toHaveBeenCalled();}finally{unlinkSync(link);}
  });
  it('rejects an extra runtime file or writable directory',async()=>{
    const extra=join(app,'Contents/Resources/extra.py');writeFileSync(extra,'unexpected');
    try {await expect(libreOfficeResources(root)).rejects.toThrow('未登记');}finally{unlinkSync(extra);}
    const directory=join(app,'Contents/Resources/data');chmodSync(directory,0o777);
    try {await expect(libreOfficeResources(root)).rejects.toThrow('权限');}finally{chmodSync(directory,0o755);}
    expect(signer.verify).not.toHaveBeenCalled();
  },15000);
  it('rejects an escaping link before invoking recursive codesign',async()=>{
    const path=join(app,'Contents/Resources/runtime-link'),outside=join(work,'outside');writeFileSync(outside,'private synthetic bytes');unlinkSync(path);symlinkSync(outside,path);
    writeManifest({...manifest(),files:files.map(entry=>'link' in entry ? {...entry,link:outside} : entry)});
    try {await expect(libreOfficeResources(root)).rejects.toThrow('链接');expect(signer.verify).not.toHaveBeenCalled();}finally{unlinkSync(path);symlinkSync('../Frameworks/libmergedlo.dylib',path);}
  },15000);
  it('rejects altered regular bytes even when codesign returns success',async()=>{
    const path=join(app,required[1]);writeFileSync(path,'corrupt');
    try {await expect(libreOfficeResources(root)).rejects.toThrow('资源校验失败');}finally{writeFileSync(path,'fixture');}
  },15000);
  it('requires the component to belong to the verified enclosing package',async()=>{
    const other=join(work,'Other.app');mkdirSync(other);
    await expect(libreOfficeResources(root,other)).rejects.toThrow('当前安装包');expect(signer.verify).not.toHaveBeenCalled();
  },15000);
  it('honors cancellation before filesystem or signature work',async()=>{
    const abort=new AbortController();abort.abort(new Error('cancel resource verification'));
    await expect(libreOfficeResources(root,undefined,abort.signal)).rejects.toThrow('cancel resource verification');expect(signer.verify).not.toHaveBeenCalled();
  });
});
