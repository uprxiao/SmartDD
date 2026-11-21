import { parse as parseToml } from 'smol-toml';
import { agentPermission, type AgentPermission } from '@shared/agent-permissions';
import type { CodeAgentKind } from '@shared/ai-agents';

const claudeValues=new Set(['--model','--fallback-model','--effort','--max-turns','--max-budget-usd','--system-prompt','--append-system-prompt','--agent','--agents','--mcp-config','--add-dir']);
const codexValues=new Set(['--model','-m','--enable','--disable','--cd','-C','--add-dir']);
const codexSwitches=new Set(['--search','--no-alt-screen','--no-daemon']);
const codexPermissionKeys=new Set(['approval_policy','sandbox_mode','approvals_reviewer']);
const codexSafeConfigKeys=new Set(['model','model_reasoning_effort','model_reasoning_summary','model_verbosity','model_provider','model_catalog_json','analytics','features','mcp_servers','model_providers']);

function unsupported(index:number):never {
  // Never interpolate the original argument or configuration: it may be a key.
  throw new Error(`旧配置第 ${index+1} 个参数的权限边界无法核验，请在旧配置中检查；原配置未修改`);
}

/** Build a run-only copy, leaving the legacy profile's saved argv byte-exact.
 * Recognized value positions stay opaque even if their content resembles a flag.
 * Unknown/positional boundaries fail before fork rather than guessing their arity.
 * This parser alone is not native CLI or full legacy runtime acceptance.
 */
export function overlayLegacyPermission(kind:CodeAgentKind,source:readonly string[],selected:AgentPermission,model?:string) {
  const permission=agentPermission(kind,selected),retained:string[]=[];
  let originalModel:string|null=null;
  if(model&&(!model.trim()||model.length>256||/^[\s-]|[\x00-\x1f\x7f]/.test(model)))throw new Error('恢复模型无效');
  for(let index=0;index<source.length;index++){
    const token=source[index];if(!token||token==='--')unsupported(index);
    const equal=token.indexOf('='),flag=equal<0?token:token.slice(0,equal);
    const takeValue=()=>{
      if(equal>=0)return token.slice(equal+1);
      if(index+1>=source.length)unsupported(index);
      return source[++index];
    };
    if(kind==='claude'){
      if(['--dangerously-skip-permissions','--allow-dangerously-skip-permissions'].includes(flag)){
        if(equal>=0)unsupported(index);continue;
      }
      if(flag==='--permission-mode'){
        const value=takeValue();if(!['default','acceptEdits','bypassPermissions','plan','dontAsk','auto'].includes(value))unsupported(index);continue;
      }
      if(token==='--verbose'){retained.push(token);continue;}
      if(!claudeValues.has(flag))unsupported(index);
      const value=takeValue();if(!value)unsupported(index);
      if(flag==='--model'){
        if(/^[\s-]|[\x00-\x1f\x7f]/.test(value))unsupported(index);originalModel=value;
        if(model)continue;
      }
      retained.push(flag,value);continue;
    }
    if(['--approve-for-me','--dangerously-bypass-approvals-and-sandbox','--full-auto','--yolo'].includes(flag)){
      if(equal>=0)unsupported(index);continue;
    }
    if(['-s','--sandbox','-a','--ask-for-approval'].includes(flag)){
      const value=takeValue();
      const allowed=['-s','--sandbox'].includes(flag)?['read-only','workspace-write','danger-full-access']:['untrusted','on-failure','on-request','never'];
      if(!allowed.includes(value))unsupported(index);continue;
    }
    if(flag==='-c'||flag==='--config'){
      const value=takeValue();let parsed:Record<string,unknown>;
      try{parsed=parseToml(value);}catch{unsupported(index);}
      const keys=Object.keys(parsed!);if(keys.length!==1)unsupported(index);
      // Nested permissions/profiles and arbitrary config tables cannot be proved
      // safe merely by appending a new CLI flag. Keep their saved bytes intact.
      if(codexPermissionKeys.has(keys[0]))continue;
      if(!codexSafeConfigKeys.has(keys[0]))unsupported(index);
      if(keys[0]==='model'&&typeof parsed![keys[0]]==='string'){
        originalModel=parsed![keys[0]] as string;if(model)continue;
      }
      retained.push(flag,value);continue;
    }
    if(codexSwitches.has(token)){retained.push(token);continue;}
    if(!codexValues.has(flag))unsupported(index);
    const value=takeValue();if(!value)unsupported(index);
    if(flag==='-m'||flag==='--model'){
      if(/^[\s-]|[\x00-\x1f\x7f]/.test(value))unsupported(index);originalModel=value;if(model)continue;
    }
    retained.push(flag,value);
  }
  return {args:[...retained,...permission.args,...(model?[kind==='claude'?'--model':'-m',model]:[])],permission,model:model??originalModel};
}
