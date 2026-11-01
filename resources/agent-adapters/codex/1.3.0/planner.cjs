// Owned Codex 0.166.0 delivery. Pure argv planning; no user config writes or token access.
const {plan:base}=require('./base-planner.cjs');
const {createHash}=require('node:crypto');
exports.plan=(agentId,input)=>{
 const output=base(agentId,input),policy=input.cliSandbox;if(!policy)return output;
 if(agentId!=='codex'||!input.applicationSkillDelivery)throw Error('CLI delivery requires a fixed host plan');
 if(policy.kind==='unchanged')return output;
 if(policy.kind!=='inherit'||typeof policy.parent!=='string'||!policy.endpoint.startsWith('/private/tmp/wy-cli-'))throw Error('Unsupported effective sandbox');
 const name='wy_cli_'+createHash('sha256').update(policy.endpoint).digest('hex').slice(0,12);
 if(policy.existingNames.includes(name))throw Error('Temporary permissions name already exists');
 const prefix='permissions.'+JSON.stringify(name),args=['-c','default_permissions='+JSON.stringify(name),'-c',prefix+'.extends='+JSON.stringify(policy.parent),'-c',prefix+'.network.unix_sockets={'+JSON.stringify(policy.endpoint)+'="allow"}'];
 if(policy.enableNetwork)args.push('-c',prefix+'.network.enabled=true');
 if(policy.networkProxy)args.push('-c','features.network_proxy=true');
 return{...output,args:[...output.args,...args]};
};
