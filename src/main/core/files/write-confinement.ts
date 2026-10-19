import {posix} from 'node:path';
import {FileError} from '@shared/files';

// A descriptor anchors the selected inode, but an external writer can move its
// parent outside the root after the last userspace check. Restrict the commit
// process's kernel write policy as well. This profile does not restrict reads
// or replace the native identity/revision/recovery checks.
export const MAC_FILE_WRITE_PROFILE='(version 1)\n(allow default)\n(deny file-write* (require-all (require-not (subpath (param "PROJECT_ROOT"))) (require-not (subpath (param "RECOVERY_ROOT")))))\n';
export interface NativeFileCommand {executable:string;args:string[];writeConfined:boolean}
function canonicalRoot(value:unknown):string{
 const path=value&&typeof value==='object'?(value as {path?:unknown}).path:undefined;
 if(typeof path!=='string'||path.length>32768||path.includes('\0')||!posix.isAbsolute(path)||path.startsWith('//')||posix.normalize(path)!==path)throw new FileError('UNTRUSTED','无法为此目录建立受保护的文件写入范围');
 return path;
}
/** Arguments are passed directly to spawn, never a shell or interpolated
 * profile. A missing/failed system sandbox is an error, with no unsafe retry. */
export function nativeFileCommand(executable:string,input:Record<string,unknown>,platform:NodeJS.Platform):NativeFileCommand{
 if(platform!=='darwin'||input.operation!=='save'&&input.operation!=='copy')return{executable,args:[],writeConfined:false};
 const destination=input.destination&&typeof input.destination==='object'?(input.destination as {root?:unknown}).root:undefined;
 const root=canonicalRoot(input.operation==='copy'?destination:input.root),recovery=canonicalRoot(input.recoveryRoot);
 return{executable:'/usr/bin/sandbox-exec',args:['-D','PROJECT_ROOT='+root,'-D','RECOVERY_ROOT='+recovery,'-p',MAC_FILE_WRITE_PROFILE,executable],writeConfined:true};
}
