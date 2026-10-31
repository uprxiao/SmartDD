// Legacy-format argv planning only. Host verifies original source and full H inventory.
// No file/process/network actions, global settings, renaming or implicit new app bridge.
const path = require('node:path');
const fail = message => {const error=new Error(message);error.code='AGENT_CAPABILITY_NAME_CONFLICT';throw error;};
function toml(value){
 if(typeof value==='string')return JSON.stringify(value);
 if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return String(value);
 if(Array.isArray(value))return '['+value.map(toml).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.entries(value).map(([key,value])=>JSON.stringify(key)+'='+toml(value)).join(',')+'}';
 throw Error('Native configuration has an unsupported value');
}
exports.plan=function(agentId,input){
 const args=[],files={};
 if(agentId==='claude-code'){
  if(input.pluginRoot)args.push('--plugin-dir',input.pluginRoot);
  if(input.mcp.length){files['mcp.json']=JSON.stringify({mcpServers:Object.fromEntries(input.mcp.map(m=>[m.serverName,{command:m.command,args:m.args,env:m.env}]))},null,2)+'\n';args.push('--mcp-config',input.mcpConfigPath);}
 }else{
  const selected=new Set(input.selectedPaths),managed=new Map(input.managedSkills.map(s=>[s.path,s])),own=new Map(),user=[];
  for(const item of input.userSkillConfig){
   if(typeof item.path!=='string'||typeof item.enabled!=='boolean')throw Error('Native Skill configuration shape is invalid');
   const resolved=path.resolve(input.cwd,item.path),entry=managed.get(resolved)||input.managedSkills.find(s=>path.dirname(s.path)===resolved);
   if(entry){if(own.has(entry.path)||item.enabled!==selected.has(entry.path))fail('User Skill configuration conflicts with the original managed selection');own.set(entry.path,{...item,path:entry.path});}
   else user.push(item);
  }
  const merged=[...user,...input.managedSkills.map(entry=>({...own.get(entry.path),path:entry.path,enabled:selected.has(entry.path)}))];
  if(input.managedSkills.length)args.push('-c','skills.config='+toml(merged));
  for(const m of input.mcp){const prefix='mcp_servers.'+m.serverName;args.push('-c',prefix+'.command='+toml(m.command),'-c',prefix+'.args='+toml(m.args));if(Object.keys(m.env).length)args.push('-c',prefix+'.env='+toml(m.env));}
 }
 return{schema:1,agentId,args,files,phase:'prepared',bridgeRecovery:'unverified'};
};
