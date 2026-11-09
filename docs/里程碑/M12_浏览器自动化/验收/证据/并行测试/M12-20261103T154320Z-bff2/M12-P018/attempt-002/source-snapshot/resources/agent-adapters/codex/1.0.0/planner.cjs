// Pure argv/file planning only. No I/O, credentials, processes or global config edits.
const path = require('node:path');
const fail = (message) => { const error = new Error(message); error.code = 'AGENT_CAPABILITY_NAME_CONFLICT'; throw error; };
function toml(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  if (Array.isArray(value)) return '[' + value.map(toml).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.entries(value).map(([key,val]) => JSON.stringify(key) + '=' + toml(val)).join(',') + '}';
  throw new Error('Native configuration contains an unsupported value');
}
exports.plan = function(agentId,input) {
  const args = [], files = {}, snapshot = input.snapshot;
  if (agentId === 'claude-code') {
    if (input.pluginRoot && (snapshot.standardSkills.length || snapshot.packages.some(p => p.skills.length))) args.push('--plugin-dir',input.pluginRoot);
    if (input.mcp.length) { const mcpServers = Object.fromEntries(input.mcp.map(m => [m.serverName,{command:m.command,args:m.args,env:m.env}])); files['mcp.json'] = JSON.stringify({mcpServers},null,2) + '\n'; args.push('--mcp-config',input.mcpConfigPath); }
  } else {
    const selected = new Set([...snapshot.packages.flatMap(p => p.skills.map(s => s.projectionPath)),...snapshot.standardSkills.map(s => s.projectionPath)]), entries = input.catalog.entries, managed = new Map(entries.map(e => [e.path,e]));
    const user = [];
    for (const item of input.userSkillConfig) {
      if (typeof item.path !== 'string' || typeof item.enabled !== 'boolean') throw new Error('Native skill configuration shape is invalid');
      const canonical = path.resolve(snapshot.native.cwd,item.path), own = managed.get(canonical);
      if (own) { if (item.enabled !== selected.has(canonical)) fail('User skill configuration conflicts with the fixed managed selection'); }
      else user.push(item);
    }
    const merged = [...user,...entries.map(e => { const existing = input.userSkillConfig.find(i => path.resolve(snapshot.native.cwd,i.path) === e.path); return {...existing,path:e.path,enabled:selected.has(e.path)}; })];
    if (entries.length) args.push('-c','skills.config=' + toml(merged));
    for (const m of input.mcp) { const prefix = 'mcp_servers.' + m.serverName; args.push('-c',prefix + '.command=' + toml(m.command),'-c',prefix + '.args=' + toml(m.args)); if (Object.keys(m.env).length) args.push('-c',prefix + '.env=' + toml(m.env)); }
  }
  return {schema:1,agentId,args,files,phase:'prepared',bridgeRecovery:'unverified'};
};
