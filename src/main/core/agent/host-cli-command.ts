import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {delimiter,dirname,join} from 'node:path';
export interface HostBusinessCli {path:string;sha256:string}
/** Single literal shell command only. No redirection, substitution, operators, environment assignments or shell wrappers. */
export function literalShellWords(command:string):string[]|null {
 if(!command||command.length>256*1024||/[\x00-\x1f\x7f]/.test(command))return null;
 const words:string[]=[];let word='',started=false,quote:''|'single'|'double'='';
 for(let i=0;i<command.length;i++){const c=command[i];
  if(quote==='single'){if(c==="'")quote='';else word+=c;continue;}
  if(quote==='double'){if(c==='"'){quote='';continue;}if(c==='$'||c==='`')return null;if(c==='\\'){const next=command[++i];if(!next||!['"','\\','$','`'].includes(next))return null;word+=next;}else word+=c;continue;}
  if(c===' '){if(started){words.push(word);word='';started=false;}continue;}
  started=true;if(c==="'"){quote='single';continue;}if(c==='"'){quote='double';continue;}
  if(!/[A-Za-z0-9_./:@%+,=\-]/.test(c))return null;word+=c;
 }
 if(quote)return null;if(started)words.push(word);return words.length?words:null;
}
export function isHostBusinessCli(input:Record<string,unknown>,proof:HostBusinessCli|undefined,env:Record<string,string>):boolean {
 if(!proof||typeof input.command!=='string'||input.run_in_background===true||input.dangerouslyDisableSandbox===true)return false;
 const words=literalShellWords(input.command);if(!words||words.length<2)return false;
 try{const expected=realpathSync(proof.path),executable=words[0]==='willyou-app'?join((env.PATH??'').split(delimiter)[0],'willyou-app'):words[0];return realpathSync(executable)===expected&&dirname(expected)===realpathSync((env.PATH??'').split(delimiter)[0])&&createHash('sha256').update(readFileSync(expected)).digest('hex')===proof.sha256;}catch{return false;}
}
