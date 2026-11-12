import {parse as parseToml} from 'smol-toml';
import {ApplicationError} from '@shared/applications';

export const codexPermissionKeys=['approval_policy','approvals_reviewer','sandbox_mode','sandbox_workspace_write','default_permissions','permissions','network'] as const;
export type CodexPermissionKey=typeof codexPermissionKeys[number];
const unsupported=()=>new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','本次 Codex 恢复权限参数无法完整交付，保留原生入口');

/** Server startup receives the original, validated configuration. Remote resume
 * rejects permission flags at the TUI, so deliver those same choices through the
 * native thread/resume request instead. No setting is written to user config.
 */
export function codexClientArgs(profile:readonly string[],managed:readonly string[],resume:boolean):{profile:string[];managed:string[];permissionKeys:CodexPermissionKey[]}{
  const selected=new Set<CodexPermissionKey>();
  const project=(source:readonly string[])=>{
    const output:string[]=[];
    for(let i=0;i<source.length;i++){
      const raw=source[i];let flag=raw,value:string|undefined,width=1;
      const eq=raw.indexOf('=');if(eq>0){flag=raw.slice(0,eq);value=raw.slice(eq+1);}
      if(raw.startsWith('-c')&&!raw.startsWith('--')&&raw!=='-c'){flag='-c';value=raw.slice(2).replace(/^=/,'');}
      if(['-c','--config','--enable','--disable','-m','--model','-s','--sandbox','-a','--ask-for-approval'].includes(flag)&&value===undefined){value=source[i+1];width=2;}
      let key:CodexPermissionKey|undefined;
      if(flag==='-s'||flag==='--sandbox')key='sandbox_mode';
      else if(flag==='-a'||flag==='--ask-for-approval')key='approval_policy';
      else if(flag==='-c'||flag==='--config'){
        if(!value)throw unsupported();const split=value.indexOf('=');if(split<1)throw unsupported();
        try{const parsed=parseToml(value.slice(0,split)+'=true'),roots=Object.keys(parsed);if(roots.length!==1)throw unsupported();if(codexPermissionKeys.includes(roots[0] as CodexPermissionKey))key=roots[0] as CodexPermissionKey;}
        catch{throw unsupported();}
      }
      if(resume&&key){if(value===undefined)throw unsupported();selected.add(key);}
      // A dedicated per-run server replaces implicit daemon selection. Native
      // --no-daemon and --remote are mutually exclusive even for new tasks.
      else if(flag!=='--no-daemon')output.push(...source.slice(i,i+width));
      i+=width-1;
    }
    return output;
  };
  const p=project(profile),m=project(managed);return{profile:p,managed:m,permissionKeys:[...selected]};
}
