import http from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,symlinkSync} from 'node:fs';import {join} from 'node:path';
const root=realpathSync(mkdtempSync('/tmp/m13-a2-d-'));const reqs=[];
const mkSkill=(dir,name)=>{mkdirSync(join(dir,name,'scripts'),{recursive:true});writeFileSync(join(dir,name,'SKILL.md'),`---\nname: ${name}\ndescription: DESC-${name} marker skill for M13 A2\n---\nRun scripts/hello.sh. VERSION=v1\n`);writeFileSync(join(dir,name,'scripts/hello.sh'),'#!/bin/sh\necho HELLO-'+name+'\n');};
const home=join(root,'home'),proj=join(root,'proj');mkdirSync(home);mkdirSync(proj);
// candidate locations
const cfg=join(root,'claude-cfg'),ch=join(root,'codex-home');
const sourceA=join(root,'project-A','.claude','skills');mkSkill(sourceA,'sk-project-a-private');
mkdirSync(join(cfg,'skills'),{recursive:true});symlinkSync(join(sourceA,'sk-project-a-private'),join(cfg,'skills','sk-project-a-private'));
mkdirSync(ch,{recursive:true});
writeFileSync(join(cfg,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[proj]:{hasTrustDialogAccepted:true}}}));
writeFileSync(join(ch,'config.toml'),`[projects."${proj}"]\ntrust_level = "trusted"\n`);
const srv=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{const raw=Buffer.concat(c).toString();let b={};try{b=JSON.parse(raw)}catch{}
 if(q.url.startsWith('/v1/messages')&&!q.url.includes('count')){reqs.push({api:'anth',tools:(b.tools||[]).map(t=>t.name),skillsSeen:[...raw.matchAll(/sk-[a-z-]+/g)].map(m=>m[0]).filter((v,i,a)=>a.indexOf(v)===i)});
  r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);e('message_start',{message:{id:'m',type:'message',role:'assistant',model:'m',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:'OK'}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});e('message_stop',{});r.end();return;}
 if(q.url.endsWith('/responses')){const tools=(b.tools||[]).map(t=>t.type==='function'?t.name:t.type+(t.name?':'+t.name:''));const roots=(raw.match(/`r\d+` = `[^`]+`/g)||[]).map(s=>s.replace(root,'<root>'));reqs.push({api:'resp',tools,skillsSeen:[...raw.matchAll(/sk-[a-z-]+/g)].map(m=>m[0]).filter((v,i,a)=>a.indexOf(v)===i),roots});
  const item={id:'m',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]};r.writeHead(200,{'content-type':'text/event-stream'});const s=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');s('response.created',{response:{id:'r',status:'in_progress',output:[]}});s('response.output_item.done',{output_index:0,item});s('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();return;}
 r.writeHead(404);r.end('{}');});});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));const P=srv.address().port;const noNet={HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const run=(cmd,args,env)=>new Promise(res=>{const c=spawn(cmd,args,{cwd:proj,env:{PATH:process.env.PATH,...noNet,...env},stdio:['ignore','pipe','pipe']});const k=setTimeout(()=>c.kill(),60000);c.on('close',()=>{clearTimeout(k);res();});});
await run('claude',['-p','--model','m','hi'],{HOME:home,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${P}`,ANTHROPIC_AUTH_TOKEN:'t',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
srv.close();console.log(JSON.stringify(reqs.map(r=>({...r,tools:r.tools.slice(0,40)})),null,1));
