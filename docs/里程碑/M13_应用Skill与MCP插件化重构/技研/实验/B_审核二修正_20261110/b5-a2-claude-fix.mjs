// 补验 B5（审核二 F07-A2）：修正 a2b.mjs 模拟模型——原版所有响应共用 message id 'm'，Claude 将其合并为同一条 assistant，
// 导致按 assistant 条数计步恒为 1、反复下发 Bash 至 90s 超时（退出 143）。本版：每次响应唯一 id，按 tool_result 累计数计步；只跑 Claude 四组＋删除组，并加第三方运行新规则 --setting-sources user。
// 原注释：A2：Skill 跨 Agent 生命周期（按次注入／独立目录链接），模拟模型真实调用 Skill 并运行相对脚本
import http from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,symlinkSync,rmSync,existsSync,lstatSync,readdirSync,readlinkSync} from 'node:fs';import {join,resolve} from 'node:path';
const root=realpathSync(mkdtempSync('/tmp/m13-b5-run-'));const out={cases:{}};const CODEX='/Users/liubu/.local/bin/codex';
const home=join(root,'home'),proj=join(root,'proj');mkdirSync(home);mkdirSync(proj);
mkdirSync(join(root,'codex-user-home'));const SCRIPT_LOG=join(root,'script.log');writeFileSync(SCRIPT_LOG,'');
const writeSkill=(dir,name,ver)=>{mkdirSync(join(dir,name,'scripts'),{recursive:true});writeFileSync(join(dir,name,'SKILL.md'),`---\nname: ${name}\ndescription: DESC-${name} for M13 A2\n---\nRun the helper: sh scripts/hello.sh . VERSION=${ver}\n`);writeFileSync(join(dir,name,'scripts/hello.sh'),`#!/bin/sh\necho "HELLO ${name} ${ver} cwd=$(pwd)" >> ${SCRIPT_LOG}\necho HELLO-${ver}\n`);};
// Source: Codex-side installer put skill into ~/.agents/skills (Codex user scope) ; Claude-side source in project .claude/skills
const SRC_USER=join(home,'.agents/skills');writeSkill(SRC_USER,'wydemo','v1');
const SRC_PROJ=join(proj,'.claude/skills');writeSkill(SRC_PROJ,'wyproj','v1');
let calls=[];
const srv=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{const raw=Buffer.concat(c).toString();let b={};try{b=JSON.parse(raw)}catch{}
 if(q.url.startsWith('/v1/messages')&&!q.url.includes('count')){const msgs=b.messages||[];const last=msgs.at(-1);const trs=Array.isArray(last?.content)?last.content.filter(x=>x.type==='tool_result'):[];
  const want=(JSON.stringify(msgs[0]?.content).match(/USE ([a-z:-]+)/)||[])[1];const skillTool=(b.tools||[]).find(t=>t.name==='Skill');const listed=skillTool?[...JSON.stringify(skillTool).matchAll(/"?(?:[a-z-]+:)?wy[a-z]+/g)].map(m=>m[0].replace(/^"/,'')).filter((v,i,a)=>a.indexOf(v)===i):[];
  const sysListed=[...raw.matchAll(/[a-z-]*:?wy(demo|proj)/g)].map(m=>m[0]).filter((v,i,a)=>a.indexOf(v)===i);
  const step=msgs.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(x=>x.type==='tool_result').length;const trText=trs.map(t=>typeof t.content==='string'?t.content:(t.content||[]).map(x=>x.text).join('')).join('|');const bodyVer=(raw.match(/VERSION=([A-Za-z0-9-]+)/)||[])[1]||null;const baseDir=(raw.match(/Base directory for this skill: ([^\\"\s]+)/)||[])[1]||null;
  calls.push({api:'anth',step,bodyVer,baseDir:baseDir&&baseDir.replace(root,'<root>'),listedInSkillTool:listed,mentioned:sysListed,trText:trText.slice(0,260)});
  let blk;if(step===0&&want)blk={type:'tool_use',id:'t1',name:'Skill',input:{skill:want}};
  else if(step===1){const base=baseDir;blk=base?{type:'tool_use',id:'t2',name:'Bash',input:{command:`cd "${base}" && sh scripts/hello.sh`,description:'run'}}:{type:'text',text:'NOBASE'};}
  else blk={type:'text',text:'DONE '+trText.slice(0,80)};
  r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);e('message_start',{message:{id:'msg_'+Math.random().toString(36).slice(2),type:'message',role:'assistant',model:'m',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
  if(blk.type==='text'){e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:blk.text}});}else{e('content_block_start',{index:0,content_block:{...blk,input:{}}});e('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(blk.input)}});}
  e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:blk.type==='text'?'end_turn':'tool_use'},usage:{output_tokens:1}});e('message_stop',{});r.end();return;}
 if(q.url.endsWith('/responses')){const input=b.input||[];const outs=input.filter(x=>x.type==='function_call_output');const want=(JSON.stringify(input.filter(x=>x.role==='user')).match(/USE ([a-z-]+)/)||[])[1];
  const roots=Object.fromEntries((raw.match(/`r\d+` = `[^`]+`/g)||[]).map(s=>{const m=/`(r\d+)` = `([^`]+)`/.exec(s);return [m[1],m[2]];}));const entry=want?(raw.match(new RegExp(`- ${want}: [^(]*\\(file: (r\\d+)/([^)]+)\\)`))||[]):[];
  const file=entry[1]?join(roots[entry[1]],entry[2]):null;calls.push({api:'resp',step:outs.length,bodyVer:(outs.map(o=>JSON.stringify(o.output)).join('').match(/VERSION=([A-Za-z0-9-]+)/)||[])[1]||null,listed:[...raw.matchAll(/- (wy[a-z]+): /g)].map(m=>m[1]),file:file&&file.replace(root,'<root>'),out:outs.map(o=>String(typeof o.output==='string'?o.output:JSON.stringify(o.output)).slice(0,200)).join('|')});
  let item;if(outs.length===0&&file)item={id:'fc1',type:'function_call',status:'completed',call_id:'c1',name:'exec_command',arguments:JSON.stringify({cmd:`cat "${file}"`})};
  else if(outs.length===1&&file)item={id:'fc2',type:'function_call',status:'completed',call_id:'c2',name:'exec_command',arguments:JSON.stringify({cmd:`cd "${resolve(file,'..')}" && sh scripts/hello.sh`})};
  else item={id:'m',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'DONE',annotations:[]}]};
  r.writeHead(200,{'content-type':'text/event-stream'});const s=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');s('response.created',{response:{id:'r',status:'in_progress',output:[]}});s('response.output_item.done',{output_index:0,item});s('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();return;}
 r.writeHead(404);r.end('{}');});});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));const P=srv.address().port;const noNet={HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const scriptLines=()=>readFileSync(SCRIPT_LOG,'utf8').split('\n').filter(Boolean);
function claude(lbl,cfg,extra,want){return new Promise(res=>{const cb=calls.length,sb=scriptLines().length;const c=spawn('claude',['-p','--output-format','json','--allowedTools','Skill','Bash(sh:*)','Bash(cd:*)','Bash',...extra,'--model','m',`please USE ${want}`],{cwd:proj,env:{PATH:process.env.PATH,HOME:home,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${P}`,ANTHROPIC_AUTH_TOKEN:'t',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',...noNet},stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill(),90000);
 c.on('close',code=>{clearTimeout(k);out.cases[lbl]={code,calls:calls.slice(cb),script:scriptLines().slice(sb).map(l=>l.replace(root,'<root>')),stderr:se.split('\n').filter(l=>l&&!/unrecognized/.test(l)).slice(-2).map(l=>l.slice(0,200).replace(root,'<root>'))};res();});});}
function codex(lbl,ch,extra,want){return new Promise(res=>{const cb=calls.length,sb=scriptLines().length;const c=spawn(CODEX,['exec','--skip-git-repo-check','--json','-c','analytics.enabled=false','-c','approval_policy="never"','-c','sandbox_mode="danger-full-access"','-c','model_provider="m"','-c',`model_providers.m={name="m",base_url="http://127.0.0.1:${P}/v1",wire_api="responses",env_key="K"}`,'-m','m',...extra,`please USE ${want}`],{cwd:proj,env:{PATH:process.env.PATH,HOME:join(root,'codex-user-home'),CODEX_HOME:ch,K:'k',...noNet},stdio:['ignore','pipe','pipe']});let se='';c.stderr.on('data',b=>se+=b);c.stdout.on('data',()=>{});const k=setTimeout(()=>c.kill(),90000);
 c.on('close',code=>{clearTimeout(k);out.cases[lbl]={code,calls:calls.slice(cb),script:scriptLines().slice(sb).map(l=>l.replace(root,'<root>')),stderr:se.split('\n').filter(l=>l&&!/Reading additional/.test(l)).slice(-2).map(l=>l.slice(0,200).replace(root,'<root>'))};res();});});}
// ---- WillYou managed per-run artifacts
const cfgIso=join(root,'claude-iso');mkdirSync(join(cfgIso,'skills'),{recursive:true});writeFileSync(join(cfgIso,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[proj]:{hasTrustDialogAccepted:true}}}));
symlinkSync(join(SRC_USER,'wydemo'),join(cfgIso,'skills','wydemo'));writeFileSync(join(cfgIso,'skills','.willyou-managed.json'),JSON.stringify({managed:{wydemo:join(SRC_USER,'wydemo')}}));
const plug=join(root,'run-plugin');mkdirSync(join(plug,'.claude-plugin'),{recursive:true});mkdirSync(join(plug,'skills'));writeFileSync(join(plug,'.claude-plugin/plugin.json'),JSON.stringify({name:'willyou-run',version:'0.0.0',description:'WillYou per-run skills'}));symlinkSync(join(SRC_USER,'wydemo'),join(plug,'skills','wydemo'));
const cfgPlain=join(root,'claude-plain');mkdirSync(cfgPlain);writeFileSync(join(cfgPlain,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[proj]:{hasTrustDialogAccepted:true}}}));
const chA=join(root,'codex-home');mkdirSync(chA);writeFileSync(join(chA,'config.toml'),'');
mkdirSync(join(root,'codex-user-home/.agents/skills'),{recursive:true});symlinkSync(join(SRC_PROJ,'wyproj'),join(root,'codex-user-home/.agents/skills/wyproj'));mkdirSync(join(proj,'.agents/skills'),{recursive:true});symlinkSync(join(SRC_USER,'wydemo'),join(proj,'.agents/skills/wydemo'));
const codexCfg=p=>['-c',`skills.config=[{path=${JSON.stringify(p)},enabled=true}]`];
const phase=async ver=>{
 await claude(`${ver}_claude_isolated_symlink`,cfgIso,['--setting-sources','user'],'wydemo');
 await claude(`${ver}_claude_plugindir`,cfgPlain,['--plugin-dir',plug],'willyou-run:wydemo');};
await phase('v1');
writeSkill(SRC_USER,'wydemo','v2');writeSkill(SRC_PROJ,'wyproj','v2');await phase('v2');
rmSync(join(SRC_USER,'wydemo'),{recursive:true});rmSync(join(SRC_PROJ,'wyproj'),{recursive:true});await phase('removed');
// conflict: user's own real skill with same name in target root
const cfgC=join(root,'claude-conflict');mkdirSync(join(cfgC,'skills'),{recursive:true});writeFileSync(join(cfgC,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true}));writeSkill(join(cfgC,'skills'),'wydemo','USER-OWN');
out.target_dir_listing_after_removed={iso:readdirSync(join(cfgIso,'skills')).map(n=>({n,link:lstatSync(join(cfgIso,'skills',n)).isSymbolicLink(),dangling:lstatSync(join(cfgIso,'skills',n)).isSymbolicLink()&&!existsSync(join(cfgIso,'skills',n))}))};
srv.close();const txt=JSON.stringify(out,null,1).replaceAll(root,'<root>');writeFileSync(join(root,'result.json'),txt);console.log(txt);
