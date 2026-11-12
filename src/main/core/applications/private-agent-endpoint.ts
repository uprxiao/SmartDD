import {chmodSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readlinkSync,readdirSync,realpathSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {agentControlRootPath,codexDaemonRootPath} from './agent-control-path';
import {canonicalJson,digest} from './manifest';

const denied=()=>new ApplicationError('RESOURCE_RECOVERY_REQUIRED','私有 Agent 端点归属或内容发生变化，保留目录等待核查');
const directorySeal=(path:string)=>{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700||realpathSync(path)!==path)throw denied();return s.dev+':'+s.ino;};
/** No global config or credential files. Only this marked, original directory is removed. */
export class PrivateAgentEndpoint {
  readonly directory:string;
  readonly path:string;
  readonly url:string;
  private readonly seal:string;
  private readonly marker:string;
  private socketSeal?:string;
  private aliasSeal?:string;
  private physicalSeal?:string;
  readonly socketObservations:{type:string;uid:number;mode:number;identity:string;target?:string}[]=[];
  constructor(identity:{storeId:string;runId:string}){
    const base=agentControlRootPath();try{mkdirSync(base,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    directorySeal(base);this.directory=realpathSync(mkdtempSync(join(base,'r-')));chmodSync(this.directory,0o700);this.seal=directorySeal(this.directory);
    this.path=join(this.directory,'c.sock');this.url='unix://'+this.path;
    this.marker=canonicalJson({schema:'willyou-private-agent-endpoint-v1',...identity});
    if(Buffer.byteLength(this.path)>=100){rmdirSync(this.directory);throw new ApplicationError('INVALID_INPUT','私有 Agent 端点超过平台路径预算');}
    writeFileSync(join(this.directory,'owner.json'),this.marker,{flag:'wx',mode:0o600});
  }
  verify():void {
    if(directorySeal(this.directory)!==this.seal)throw denied();
    const path=join(this.directory,'owner.json'),s=lstatSync(path);
    if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size!==Buffer.byteLength(this.marker)||digest(readFileSync(path))!==digest(this.marker))throw denied();
  }
  verifySocket():void {
    this.verify();const s=lstatSync(this.path),observed={type:s.isSocket()?'socket':s.isSymbolicLink()?'link':s.isFile()?'file':'other',uid:s.uid,mode:s.mode,identity:s.dev+':'+s.ino,...(s.isSymbolicLink()?{target:readlinkSync(this.path)}:{})};
    if(this.socketObservations.length<8)this.socketObservations.push(observed);
    if(s.uid!==process.getuid?.())throw denied();
    if(s.isSymbolicLink()){
      // The only accepted symlink is the pinned Codex mapping of OUR marked
      // rendezvous path, under its canonical 0700 per-user physical namespace.
      const physical=this.physicalPath();directorySeal(codexDaemonRootPath());
      if(readlinkSync(this.path)!==physical)throw denied();
      const actual=lstatSync(physical);if(!actual.isSocket()||actual.isSymbolicLink()||actual.uid!==process.getuid?.()||(actual.mode&0o777)!==0o600)throw denied();
      const alias=s.dev+':'+s.ino,seal=actual.dev+':'+actual.ino;
      if(this.socketSeal||this.aliasSeal&&this.aliasSeal!==alias||this.physicalSeal&&this.physicalSeal!==seal)throw denied();
      this.aliasSeal=alias;this.physicalSeal=seal;return;
    }
    if(!s.isSocket()||this.aliasSeal)throw denied();
    const value=s.dev+':'+s.ino;
    if(this.socketSeal&&value!==this.socketSeal)throw denied();
    chmodSync(this.path,0o600);this.socketSeal=value;
  }
  private physicalPath():string{return join(codexDaemonRootPath(),digest(this.path));}
  /** Only after the original native process is confirmed exited, or no fork occurred. */
  release():void {
    this.verify();const names=readdirSync(this.directory);
    if(names.some(name=>name!=='owner.json'&&name!=='c.sock'))throw denied();
    if(names.includes('c.sock')){
      const s=lstatSync(this.path);
      if(this.aliasSeal){
        if(!s.isSymbolicLink()||s.uid!==process.getuid?.()||s.dev+':'+s.ino!==this.aliasSeal||readlinkSync(this.path)!==this.physicalPath())throw denied();
        this.releasePhysical();unlinkSync(this.path);
      }else{if(!this.socketSeal)throw denied();this.verifySocket();unlinkSync(this.path);}
    }else if(this.aliasSeal)this.releasePhysical();
    unlinkSync(join(this.directory,'owner.json'));rmdirSync(this.directory);
  }
  private releasePhysical():void {
    directorySeal(codexDaemonRootPath());const physical=this.physicalPath();
    let s:ReturnType<typeof lstatSync>;try{s=lstatSync(physical);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    if(!s.isSocket()||s.isSymbolicLink()||s.uid!==process.getuid?.()||s.dev+':'+s.ino!==this.physicalSeal)throw denied();
    // Exact run-derived path and original inode only. Never remove the shared
    // directory, its other sockets or Codex's startup lock files.
    unlinkSync(physical);
  }
}
