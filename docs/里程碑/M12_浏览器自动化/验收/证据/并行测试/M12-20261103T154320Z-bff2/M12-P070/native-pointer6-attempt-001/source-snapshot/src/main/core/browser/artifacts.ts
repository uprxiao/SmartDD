import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, realpath, lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';

export const browserDigest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

export class BrowserArtifacts {
  private tail:Promise<unknown>=Promise.resolve();
  constructor(readonly root: string) {}
  private serialize<T>(work:()=>Promise<T>):Promise<T>{const result=this.tail.then(work);this.tail=result.catch(()=>{});return result;}
  private async checkRoot():Promise<boolean>{
    try{const stat=await lstat(this.root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ApplicationError('SCOPE_DENIED','浏览器文件根目录必须是实际目录');return true;}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  }
  async write(taskId: string, command: string, extension: 'json' | 'txt' | 'png' | 'jpeg' | 'pdf' | 'har', bytes: Uint8Array) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId) || !/^[a-z][a-z-]{0,40}$/.test(command))
      throw new ApplicationError('INVALID_INPUT', '浏览器文件归属或命令无效');
    return this.serialize(async()=>{
    await this.checkRoot();await mkdir(this.root, { recursive: true, mode: 0o700 });
    const base = await realpath(this.root), directory = join(base, taskId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new ApplicationError('SCOPE_DENIED', '浏览器文件目录不能是符号链接');
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${command}-${randomBytes(3).toString('hex')}.${extension}`;
    const path = join(directory, name), file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    return { path, bytes: bytes.byteLength, sha256: browserDigest(bytes) };
    });
  }
  usage():Promise<number>{return this.serialize(async()=>{
    if(!await this.checkRoot())return 0;
    const size=async(path:string):Promise<number>=>{const stat=await lstat(path);if(stat.isSymbolicLink())return 0;if(stat.isFile())return stat.size;if(!stat.isDirectory())return 0;let bytes=0;for(const name of await readdir(path))bytes+=await size(join(path,name));return bytes;};return size(this.root);
  });}
  clear():Promise<void>{return this.serialize(async()=>{if(!await this.checkRoot())return;for(const name of await readdir(this.root))await rm(join(this.root,name),{recursive:true,force:true});});}
  async result(taskId: string, command: string, data: unknown): Promise<unknown> {
    const bytes = Buffer.from(JSON.stringify(data));
    if (bytes.length <= 512 * 1024) return data;
    const file = await this.write(taskId, command, 'json', bytes);
    // Slice by code point after decoding, never return malformed UTF-8.
    let preview = bytes.subarray(0, 4096).toString('utf8').replace(/\uFFFD$/, '');
    while (Buffer.byteLength(preview) > 4096) preview = preview.slice(0, -1);
    return { file, truncatedPreview: preview };
  }
}
