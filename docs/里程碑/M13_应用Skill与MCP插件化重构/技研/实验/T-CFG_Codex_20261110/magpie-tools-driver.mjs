import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const CLI='/Users/liubu/.local/bin/codex';
const root=mkdtempSync('/tmp/m13-magpie2-');const home=join(root,'home'),ch=join(root,'ch'),proj=join(root,'proj');
for(const d of [home,ch,proj])mkdirSync(d,{recursive:true});
for(const f of ['a.txt','b.md','c.json'])writeFileSync(join(proj,f),'x\n');
writeFileSync(join(ch,'config.toml'),'model = "cfg-default"\n');
const env=p=>({PATH:process.env.PATH,HOME:home,CODEX_HOME:ch,NO_PROXY:'127.0.0.1,localhost',WY_MAGPIE_KEY:'magpie-codex'});
const prov=(port=3425)=>['-c','model_provider="willyou_magpie"','-c',`model_providers.willyou_magpie={name="Magpie",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",env_key="WY_MAGPIE_KEY"}`,'-c','model_catalog_json="/tmp/m13-magpie/catalog.json"'];
const common=['--skip-git-repo-check','--json','-s','read-only','-c','analytics.enabled=false','-c','feedback.enabled=false','-c','model_reasoning_effort="low"'];
const TASK='用 shell 命令 ls 列出当前目录，然后只回复一行：FILES=<文件数量>。必须实际执行命令。';
const run=(args,ms=240000)=>new Promise(r=>{const t0=Date.now();const c=spawn(CLI,args,{cwd:proj,env:env(),stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill('SIGTERM'),ms);c.on('close',(code,sig)=>{clearTimeout(k);
  const ev=so.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  const items=ev.filter(e=>e.type==='item.completed').map(e=>e.item);
  r({code,sig,sec:Math.round((Date.now()-t0)/1000),thread:ev.find(e=>e.type==='thread.started')?.thread_id,
    commands:items.filter(i=>i.type==='command_execution').map(i=>({cmd:String(i.command).slice(0,80),exit:i.exit_code,status:i.status})),
    final:items.filter(i=>i.type==='agent_message').map(i=>String(i.text).slice(0,120)).pop()??null,
    errors:[...items.filter(i=>i.type==='error').map(i=>String(i.message).slice(0,200)),...ev.filter(e=>e.type==='turn.failed'||e.type==='error').map(e=>JSON.stringify(e).slice(0,300))],
    usage:ev.filter(e=>e.type==='turn.completed').map(e=>e.usage).pop()??null,
    stderrTail:se.split('\n').filter(l=>l&&!l.startsWith('Reading additional')).slice(-2).map(l=>l.slice(0,250))});});});
const out={root,tool:{},session:[],neg:{}};
const models=JSON.parse(readFileSync('/tmp/m13-magpie/catalog.json','utf8')).models.map(m=>m.slug).filter(s=>/^(deepseek|ultrapwor)\//.test(s));
for(const m of models){out.tool[m]=await run(['exec',...common,...prov(),'-m',m,TASK]);console.error(m,JSON.stringify(out.tool[m]).slice(0,300));}
// same session cross-provider switch
const s1=await run(['exec',...common,...prov(),'-m','deepseek/deepseek-flash','记住暗号 BLUE-42，只回复 OK']);out.session.push({model:'deepseek/deepseek-flash',...s1});
for(const m of ['ultrapwor/kimi-k2.5','ultrapwor/glm-5.3-flash']){const r=await run(['exec','resume',...common,...prov(),'-m',m,s1.thread,'刚才的暗号是什么？只回复暗号']);out.session.push({model:m,...r});}
const f=[];const walk=d=>{for(const x of readdirSync(d,{withFileTypes:true})){const p=join(d,x.name);x.isDirectory()?walk(p):p.includes(s1.thread)&&f.push(p);}};walk(join(ch,'sessions'));
out.sessionTurnModels=f.length?readFileSync(f[0],'utf8').split('\n').filter(l=>l.includes('"turn_context"')).map(l=>JSON.parse(l).payload.model):null;
// negatives
out.neg.closedPort=await run(['exec',...common,...prov(3999),'-m','deepseek/deepseek-flash','回复 OK'],120000);
out.neg.unknownModel=await run(['exec',...common,...prov(),'-m','ultrapwor/no-such-model','回复 OK'],120000);
writeFileSync(join(root,'result.json'),JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
