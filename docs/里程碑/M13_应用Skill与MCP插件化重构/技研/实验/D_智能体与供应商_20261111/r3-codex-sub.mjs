// 补验 D · R3：Codex 订阅智能体真实运行（用户 2026-11-11 授权使用其 GPT 订阅）。默认 CODEX_HOME，按次注入 MCP；项目级 Skill；前后核对全局配置。
import {execFileSync,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,statSync,readdirSync,rmSync} from 'node:fs';import {join} from 'node:path';import os from 'node:os';
const H=os.homedir(),CX=join(H,'.codex'),files=['config.toml','auth.json'];
const fp=f=>{const p=join(CX,f);if(!existsSync(p))return null;const b=readFileSync(p);return{sha256:createHash('sha256').update(b).digest('hex'),size:b.length,mtimeMs:statSync(p).mtimeMs};};
const top=()=>readdirSync(CX).sort();
const root=mkdtempSync(join(os.tmpdir(),'m13-r3-'));const proj=join(root,'proj');mkdirSync(join(proj,'.agents','skills','wy-r3-probe'),{recursive:true});
writeFileSync(join(proj,'.agents','skills','wy-r3-probe','SKILL.md'),'---\nname: wy-r3-probe\ndescription: Use when the user asks for the R3 probe phrase.\n---\nThe R3 probe phrase is R3-SKILL-OK-7781. Reply with exactly that phrase.\n');
writeFileSync(join(proj,'README.md'),'r3 test project\n');
const mcpLog=join(root,'mcp.log');const fake=new URL('./fake-mcp-stdio.mjs',import.meta.url).pathname;
const env={PATH:process.env.PATH,HOME:H,TMPDIR:process.env.TMPDIR||'/tmp',TERM:'dumb'};
const out={codexVersion:execFileSync('codex',['--version'],{encoding:'utf8'}).trim(),before:Object.fromEntries(files.map(f=>[f,fp(f)])),topBefore:top()};
const ls=spawnSync('codex',['login','status'],{env,encoding:'utf8'});out.loginStatus={exit:ls.status,stdout:ls.stdout.trim(),stderr:ls.stderr.trim().split('\n').filter(l=>!/WARNING/.test(l)).join(' / ')};
const mcp=`mcp_servers.wyr3={command="node",args=${JSON.stringify([fake,mcpLog])},default_tools_approval_mode="approve"}`;
function run(label,prompt,extra=[]){const t=Date.now();const r=spawnSync('codex',['exec','--skip-git-repo-check','--json','-s','read-only','-C',proj,'-c',mcp,...extra,prompt],{env,encoding:'utf8',timeout:240000});
 const ev=r.stdout.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
 const items=ev.filter(e=>e.type==='item.completed').map(e=>e.item);const msgs=items.filter(i=>i.type==='agent_message').map(i=>i.text);
 const mcpCalls=items.filter(i=>i.type==='mcp_tool_call').map(i=>({server:i.server,tool:i.tool,status:i.status}));
 const usage=ev.filter(e=>e.type==='turn.completed').map(e=>e.usage);const thread=ev.find(e=>e.type==='thread.started')?.thread_id;
 return{label,exit:r.status,ms:Date.now()-t,lastMessage:msgs.at(-1)||null,mcpCalls,usage,threadIdPresent:!!thread,eventTypes:[...new Set(ev.map(e=>e.type))],stderrTail:(r.stderr||'').split('\n').filter(l=>l&&!/WARNING|^\s*$/.test(l)).slice(-4).join(' / ').slice(0,500)};}
out.run1=run('mcp','Call the wy_echo tool from the wyr3 MCP server exactly once, then reply with exactly: DONE');
out.mcpLogLines=existsSync(mcpLog)?readFileSync(mcpLog,'utf8').trim().split('\n').length:0;
out.run2=run('skill','What is the R3 probe phrase? Use the available skill if relevant and reply with the phrase only.');
out.after=Object.fromEntries(files.map(f=>[f,fp(f)]));out.topAfter=top();
out.globalUnchanged=Object.fromEntries(files.map(f=>[f,JSON.stringify(out.before[f])===JSON.stringify(out.after[f])]));
rmSync(root,{recursive:true,force:true});console.log(JSON.stringify(out,null,1));
