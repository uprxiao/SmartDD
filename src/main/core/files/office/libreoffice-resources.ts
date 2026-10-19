import { constants } from 'node:fs';
import { lstat, open, readlink, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { FileError, type FileIdentity } from '@shared/files';
import type { RootDescriptor } from '../native-broker';

const exec=promisify(execFile);
const VERSION='26.2.4.2', BUILD='0229ac93fcf0d7cbc6376066c6f35021cef002dc';
const ASSETS={
  arm64:{bytes:295019039,sha256:'64e0ad05564554eeee639d49b08b20908a38d4722ec95f1620d05c99bcbe9fb1',url:`https://downloadarchive.documentfoundation.org/libreoffice/old/${VERSION}/mac/aarch64/LibreOffice_${VERSION}_MacOS_aarch64.dmg`},
  x64:{bytes:305573151,sha256:'f92ba40fdada173232fe929bf77973a1ffcccec55ae7971957a6de84d33f0f1e',url:`https://downloadarchive.documentfoundation.org/libreoffice/old/${VERSION}/mac/x86_64/LibreOffice_${VERSION}_MacOS_x86-64.dmg`},
};
const MAX_BYTES=1024*1024*1024,MAX_ENTRIES=32768;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const resourcePath=z.string().min(1).max(1024).refine(path=>path.split('/').every(part=>part && part!=='.' && part!=='..' && !/[\\:\x00-\x1f]/.test(part)));
const manifestSchema=z.object({
  schema:z.literal(1),component:z.literal('willyou-office-libreoffice'),platform:z.literal('darwin'),arch:z.enum(['arm64','x64']),
  version:z.literal(VERSION),build:z.literal(BUILD),runtimeVersion:z.literal(`LibreOffice ${VERSION} ${BUILD}`),
  source:z.object({url:z.string().url(),bytes:z.number().int().positive(),sha256:hash}).strict(),
  totalBytes:z.number().int().positive().max(MAX_BYTES),
  files:z.array(z.union([
    z.object({path:resourcePath,bytes:z.number().int().nonnegative().max(256*1024*1024),sha256:hash}).strict(),
    z.object({path:resourcePath,link:z.string().min(1).max(1024)}).strict(),
  ])).min(10000).max(MAX_ENTRIES),
}).strict();
export interface LibreOfficeResources {
  runtime:RootDescriptor;
  files:{path:string;identity:FileIdentity;hash:string}[];
  links:{path:string;target:string}[];
  bytes:number;
}
function untrusted(message:string):never {throw new FileError('UNTRUSTED',message);}
const identity=(stat:{dev:bigint;ino:bigint}):FileIdentity=>({device:String(stat.dev),inode:String(stat.ino)});
const within=(root:string,path:string)=>{const name=relative(root,path);return name!=='' && name!=='..' && !name.startsWith(`..${sep}`) && !isAbsolute(name);};

/** Build-time-only resources. No ambient Office installation or runtime download.
 * Every file and contained symlink is verified before the native broker receives
 * identities and hashes; the broker must recheck them before execution. */
export async function libreOfficeResources(directory:string,packagePath?:string,signal?:AbortSignal):Promise<LibreOfficeResources> {
  signal?.throwIfAborted();
  const requested=resolve(directory),requestedInfo=await lstat(requested,{bigint:true});
  if(!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink())untrusted('Office 文档引擎目录不能是链接');
  const root=await realpath(requested),before=await lstat(root,{bigint:true});
  if(before.dev!==requestedInfo.dev || before.ino!==requestedInfo.ino || (before.mode&0o022n))untrusted('Office 文档引擎目录身份或权限异常');
  const manifestPath=join(root,'resources.json'),manifestFile=await open(manifestPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  let manifest:z.infer<typeof manifestSchema>,manifestRecord:LibreOfficeResources['files'][number];
  try {
    const stat=await manifestFile.stat({bigint:true});
    if(!stat.isFile() || (stat.mode&0o022n) || stat.size>16n*1024n*1024n)untrusted('Office 文档引擎清单大小或权限异常');
    const bytes=await manifestFile.readFile(),current=await lstat(manifestPath,{bigint:true}),after=await manifestFile.stat({bigint:true});
    if(current.isSymbolicLink() || current.dev!==stat.dev || current.ino!==stat.ino || after.size!==stat.size || after.mtimeNs!==stat.mtimeNs || after.ctimeNs!==stat.ctimeNs)throw new FileError('CHANGED','Office 文档引擎清单在读取时改变');
    let json:unknown;
    try {json=JSON.parse(bytes.toString('utf8'));} catch {untrusted('Office 文档引擎清单不是有效 JSON');}
    const parsed=manifestSchema.safeParse(json);
    if(!parsed.success)untrusted('Office 文档引擎清单不符合固定版本或资源预算');
    manifest=parsed.data;manifestRecord={path:'resources.json',identity:identity(stat),hash:createHash('sha256').update(bytes).digest('hex')};
  } finally {await manifestFile.close();}
  if(process.platform!=='darwin' || manifest.arch!==process.arch)throw new FileError('UNSUPPORTED','Office 文档引擎与本机平台或架构不匹配');
  const source=ASSETS[manifest.arch];
  if(Object.keys(source).some(key=>source[key as keyof typeof source]!==manifest.source[key as keyof typeof source]))untrusted('Office 文档引擎来源与固定官方下载不匹配');
  const entries=new Map(manifest.files.map(entry=>[entry.path,entry]));
  const required=['Contents/MacOS/soffice','Contents/Info.plist','Contents/Frameworks/libmergedlo.dylib','Contents/Resources/fundamentalrc','Contents/Resources/registry/main.xcd','Contents/Resources/LICENSE','Contents/Resources/LICENSE.html','Contents/Resources/NOTICE'];
  if(entries.size!==manifest.files.length || required.some(path=>!entries.has(path) || 'link' in entries.get(path)!))untrusted('Office 文档引擎清单缺件或存在重复路径');
  if(manifest.files.reduce((sum,entry)=>sum+('bytes' in entry ? entry.bytes : 0),0)!==manifest.totalBytes)untrusted('Office 文档引擎清单容量不一致');
  const app=join(root,'LibreOffice.app');
  const actual:string[]=[];
  const directories=new Map<string,FileIdentity>();
  const walk=async(path:string,depth:number)=>{
    if(depth>48 || actual.length>MAX_ENTRIES+1 || directories.size>MAX_ENTRIES)untrusted('Office 文档引擎目录超过遍历预算');
    const absolute=join(root,path),stat=await lstat(absolute,{bigint:true});
    if(!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o022n))untrusted('Office 文档引擎子目录权限或类型异常');
    directories.set(path,identity(stat));
    for(const item of await readdir(absolute,{withFileTypes:true})) {
      signal?.throwIfAborted();const name=path ? `${path}/${item.name}` : item.name;
      if(item.isDirectory())await walk(name,depth+1);else actual.push(name);
      if(actual.length>MAX_ENTRIES+1)untrusted('Office 文档引擎资源数量超限');
    }
  };
  await walk('',0);
  if(actual.length!==entries.size+1 || actual.some(path=>path!=='resources.json' && (!path.startsWith('LibreOffice.app/') || !entries.has(path.slice('LibreOffice.app/'.length)))))untrusted('Office 文档引擎含有缺失或未登记的资源');
  // Reject escaping links before codesign recursively inspects the bundle.
  for(const entry of manifest.files) {
    signal?.throwIfAborted();const path=join(app,entry.path),stat=await lstat(path);
    if('link' in entry) {
      if(!stat.isSymbolicLink() || await readlink(path)!==entry.link || !within(app,await realpath(path)))untrusted('Office 文档引擎链接超出完整资源包');
    } else if(!stat.isFile() || stat.isSymbolicLink() || (stat.mode&0o022))untrusted('Office 文档引擎资源权限或类型异常');
  }
  if(packagePath) {
    const enclosing=await realpath(packagePath);
    if(!within(enclosing,root))untrusted('Office 文档引擎不在当前安装包内');
    await exec('/usr/bin/codesign',['--verify','--deep','--strict',enclosing],{timeout:30_000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin'},signal});
  }
  // Keep the vendor signature even inside a WillYou bundle. codesign treats
  // -R as a filename unless the requirement starts with '='.
  await exec('/usr/bin/codesign',['--verify','--deep','--strict','-R','=anchor apple generic and identifier "org.libreoffice.script" and certificate leaf[subject.OU] = "7P5S3ZLCN7"',app],{timeout:30_000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin'},signal});
  const files=[manifestRecord],links:LibreOfficeResources['links']=[];let total=0;
  for(const entry of manifest.files) {
    signal?.throwIfAborted();const name=`LibreOffice.app/${entry.path}`,path=join(root,name);
    if('link' in entry) {
      const stat=await lstat(path);
      if(!stat.isSymbolicLink() || await readlink(path)!==entry.link || !within(app,await realpath(path)))untrusted('Office 文档引擎链接超出完整资源包');
      links.push({path:name,target:entry.link});continue;
    }
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const stat=await handle.stat({bigint:true});
      if(!stat.isFile() || (stat.mode&0o022n) || stat.size>256n*1024n*1024n)untrusted('Office 文档引擎资源权限或大小异常');
      total+=Number(stat.size);if(total>MAX_BYTES)untrusted('Office 文档引擎资源超过 1 GiB');
      const digest=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false,start:0})){signal?.throwIfAborted();digest.update(chunk);}
      const checksum=digest.digest('hex'),after=await handle.stat({bigint:true}),current=await lstat(path,{bigint:true});
      if(current.isSymbolicLink() || current.dev!==stat.dev || current.ino!==stat.ino || after.size!==stat.size || after.mtimeNs!==stat.mtimeNs || after.ctimeNs!==stat.ctimeNs)throw new FileError('CHANGED','Office 文档引擎资源在校验时改变');
      if(stat.size!==BigInt(entry.bytes) || checksum!==entry.sha256)untrusted(`Office 文档引擎资源校验失败：${entry.path}`);
      files.push({path:name,identity:identity(stat),hash:checksum});
    } finally {await handle.close();}
  }
  for(const [path,expected] of directories) {
    const stat=await lstat(join(root,path),{bigint:true});
    if(!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode&0o022n) || String(stat.dev)!==expected.device || String(stat.ino)!==expected.inode)throw new FileError('CHANGED','Office 文档引擎目录在校验时改变');
  }
  return {runtime:{path:root,identity:identity(before)},files,links,bytes:total};
}
