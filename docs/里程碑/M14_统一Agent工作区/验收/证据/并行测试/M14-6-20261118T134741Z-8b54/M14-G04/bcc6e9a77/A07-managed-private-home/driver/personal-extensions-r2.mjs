import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

export const personalNames=['a07_personal_mcp_one','a07_personal_mcp_two','a07-personal-skill','A07_PERSONAL_HOOK'];
export const models={codex:'a07-local-codex',claude:'a07-local-claude'};
export const pattern=/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}\/runtime-[A-Za-z0-9]+\/home$/;
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

export function inventoryFiles(home,stage,node){
  assert.match(home,pattern);
  assert.equal(realpathSync(home),home);
  assert([1,2].includes(stage));
  assert.match(node,/^\/[a-zA-Z0-9._\/-]+$/);
  const mcp=personalNames[stage-1];
  const hookHit=join(home,'a07-hook-hit.txt');
  const mcpHit=join(home,'a07-mcp-process.txt');
  const executable=join(home,'a07-stdio.mjs');
  const hookScript=join(home,'a07-hook.mjs');
  const hookSettings={hooks:{SessionStart:[{hooks:[{type:'command',command:node+' '+hookScript}]}]}};
  const skill='---\nname: a07-personal-skill\ndescription: A07 personal Skill marker '+stage+'\n---\n\nLocal canary only.\n';
  const files={
    '.claude.json':JSON.stringify({hasCompletedOnboarding:true,mcpServers:{[mcp]:{type:'stdio',command:node,args:[executable]}}})+'\n',
    '.claude/settings.json':JSON.stringify(hookSettings)+'\n',
    '.claude/skills/a07-personal-skill/SKILL.md':skill,
    '.codex/config.toml':[
      'model = "a07-test-root-wrong-model"','model_provider = "a07_local"',
      'approval_policy = "never"','approvals_reviewer = "auto_review"','cli_auth_credentials_store = "file"',
      '[features]','hooks = true','[analytics]','enabled = false','[feedback]','enabled = false',
      '[model_providers.a07_local]','name = "A07 private loopback"', 'base_url = "http://127.0.0.1:3425/v1"',
      'wire_api = "responses"','requires_openai_auth = false','[mcp_servers.'+mcp+']',
      'command = '+JSON.stringify(node),'args = ['+JSON.stringify(executable)+']',
    ].join('\n')+'\n',
    '.codex/hooks.json':JSON.stringify(hookSettings)+'\n',
    '.codex/skills/a07-personal-skill/SKILL.md':skill,
    '.agents/skills/a07-personal-skill/SKILL.md':skill,
    'a07-hook.mjs':"import { appendFileSync } from 'node:fs';\nappendFileSync("+JSON.stringify(hookHit)+",'A07_PERSONAL_HOOK\\n',{mode:0o600});\n",
    'a07-stdio.mjs':`import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
appendFileSync(${JSON.stringify(mcpHit)},${JSON.stringify(mcp+'\n')},{mode:0o600});
createInterface({input:process.stdin}).on('line',line=>{
  const q=JSON.parse(line);if(q.id===undefined)return;
  const reply=q.method==='initialize'?{protocolVersion:q.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:${JSON.stringify(mcp)},version:'1.0.0'}}:
    q.method==='tools/list'?{tools:[{name:'a07_personal_echo',description:'A07 synthetic extension proof',inputSchema:{type:'object',additionalProperties:false}}]}:
    {content:[{type:'text',text:'A07_PERSONAL_MCP_LOCAL_ONLY'}]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:reply})+'\\n');
});
`,
  };
  const paths=[];
  for(const [name,content] of Object.entries(files)){
    const path=join(home,name);
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    if(existsSync(path))assert.equal(realpathSync(path),path);
    writeFileSync(path,content,{flag:stage===1?'wx':'w',mode:0o600});
    paths.push(path);
  }
  return {stage,mcp,hookHit,mcpHit,paths,hashes:hashInventory(paths)};
}

export function hashInventory(paths){
  return Object.fromEntries(paths.map(path=>[path,sha(path)]));
}

export function observeCatalog(kind,body){
  // r2: Codex also lists built-in tools without a name (576); keep them as empty strings instead of failing.
  const tools=(body.tools??[]).flatMap(tool=>tool.type==='namespace'
    ?(tool.tools??[]).map(entry=>String(tool.name??'')+' '+String(entry.name??'')):[String(tool.name??tool.type??'')]);
  const prompt=kind==='claude'?JSON.stringify(body.system??[]):JSON.stringify((body.input??[]).filter(row=>['developer','system'].includes(row.role)));
  const personal=personalNames.filter(needle=>tools.some(name=>name.includes(needle))||prompt.includes(needle));
  const hostTool=tools.some(name=>name==='wy_targets'||name.endsWith('__wy_targets')||name.endsWith(' wy_targets'));
  return {personal,hostTool,tools:tools.filter(name=>name.includes('a07')||name.includes('wy_targets'))};
}
