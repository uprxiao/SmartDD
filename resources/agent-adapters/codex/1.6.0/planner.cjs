// M11 R1.0 library delivery. Skills are read from the shared library (or the Agent's links to it),
// so argv carries only the application MCP bridges and, for Codex, the inherited CLI permission profile.
// Pure planning: no I/O, credentials, processes or global config edits.
const {createHash}=require('node:crypto');
function toml(value){
 if(typeof value==='string')return JSON.stringify(value);
 if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return String(value);
 if(Array.isArray(value))return '['+value.map(toml).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.entries(value).map(([key,val])=>JSON.stringify(key)+'='+toml(val)).join(',')+'}';
 throw Error('Native configuration contains an unsupported value');
}
function sandbox(policy){
 if(!policy||policy.kind==='unchanged')return [];
 if(policy.kind!=='inherit'||typeof policy.parent!=='string'||!policy.endpoint.startsWith('/private/tmp/wy-cli-'))throw Error('Unsupported effective sandbox');
 const name='wy_cli_'+createHash('sha256').update(policy.endpoint).digest('hex').slice(0,12);
 if(policy.existingNames.includes(name))throw Error('Temporary permissions name already exists');
 // Codex 0.166.0 resolves default_permissions only against a bare TOML key.
 if(!/^wy_cli_[0-9a-f]{12}$/.test(name))throw Error('Temporary permissions name must be a bare TOML key');
 const prefix='permissions.'+name,args=['-c','default_permissions='+JSON.stringify(name),'-c',prefix+'.extends='+JSON.stringify(policy.parent),'-c',prefix+'.network.unix_sockets={'+JSON.stringify(policy.endpoint)+'="allow"}'];
 if(policy.enableNetwork)args.push('-c',prefix+'.network.enabled=true');
 if(policy.networkProxy)args.push('-c','features.network_proxy=true');
 return args;
}
exports.plan=(agentId,input)=>{
 const args=[],files={};
 if(agentId==='claude-code'){
  if(input.cliSandbox)throw Error('Claude Code has no verified CLI entry');
  if(input.mcp.length){files['mcp.json']=JSON.stringify({mcpServers:Object.fromEntries(input.mcp.map(m=>[m.serverName,{command:m.command,args:m.args,env:m.env}]))},null,2)+'\n';args.push('--mcp-config',input.mcpConfigPath);}
 }else{
  for(const m of input.mcp){const prefix='mcp_servers.'+m.serverName;args.push('-c',prefix+'.command='+toml(m.command),'-c',prefix+'.args='+toml(m.args));if(Object.keys(m.env).length)args.push('-c',prefix+'.env='+toml(m.env));}
  args.push(...sandbox(input.cliSandbox));
 }
 return{schema:1,agentId,args,files,phase:'prepared',bridgeRecovery:'unverified'};
};
