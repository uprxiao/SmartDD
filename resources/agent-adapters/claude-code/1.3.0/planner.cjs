// Candidate only: not published or declared supported until real gateway validation.
// Retained 1.2.0 remains immutable. No credentials or user configuration writes.
exports.plan=input=>{
 const args=[],files={};
 if(input.snapshot?.runner!=='claude-code'||input.native?.runner!=='claude-code')throw Error('Claude planner runner mismatch');
 if(input.mcp.length){files['mcp.json']=JSON.stringify({mcpServers:Object.fromEntries(input.mcp.map(m=>[m.serverName,{command:m.command,args:m.args,env:m.env}]))},null,2)+'\n';args.push('--mcp-config',input.mcpConfigPath);}
 const policy=input.cliSandbox;
 if(policy){
  if(input.cliVersion!=='2.1.322'||policy.runner!=='claude-code'||!['unchanged','allow-unix'].includes(policy.kind)||!/^\/private\/tmp\/wy-cli-\d+-[A-Za-z0-9]+\/cli\.sock$/.test(policy.endpoint)||Object.keys(policy).some(k=>!['runner','endpoint','kind','source','digest'].includes(k)))throw Error('Unverified Claude CLI sandbox');
  if(typeof policy.source!=='string'||!policy.source||!/^[a-f0-9]{64}$/.test(policy.digest))throw Error('Missing effective policy proof');
  // The native settings source remains authoritative. The measured overlay
  // adds one Unix address only; no enabled/approval/file/network broadening.
  if(policy.kind==='allow-unix')args.push('--settings',JSON.stringify({sandbox:{network:{allowUnixSockets:[policy.endpoint]}}}));
 }
 return{schema:1,agentId:'claude-code',args,files,phase:'prepared',bridgeRecovery:'unverified'};
};
