import http from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,symlinkSync,lstatSync,readdirSync,readlinkSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';
const root=realpathSync(mkdtempSync('/tmp/m13-a2-c-'));const out={};
const sk=(d,n,tag)=>{mkdirSync(join(d,n),{recursive:true});writeFileSync(join(d,n,'SKILL.md'),`---\nname: ${n}\ndescription: DESC-${tag}\n---\n${tag}\n`);};
const home=join(root,'home'),proj=join(root,'proj'),ch=join(root,'ch'),src=join(root,'src');for(const d of [home,proj,ch,src])mkdirSync(d,{recursive:true});
sk(join(home,'.agents/skills'),'dup','USER-OWN-HOME-AGENTS');sk(join(ch,'skills'),'dup','IN-CODEX-HOME');sk(join(proj,'.agents/skills'),'dup','IN-PROJECT');
let raw='';const srv=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{raw=Buffer.concat(c).toString();const item={id:'m',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]};r.writeHead(200,{'content-type':'text/event-stream'});const s=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');s('response.created',{response:{id:'r',status:'in_progress',output:[]}});s('response.output_item.done',{output_index:0,item});s('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();});});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));
await new Promise(res=>{const c=spawn('/Users/liubu/.local/bin/codex',['exec','--skip-git-repo-check','-c','model_provider="m"','-c',`model_providers.m={name="m",base_url="http://127.0.0.1:${srv.address().port}/v1",wire_api="responses",env_key="K"}`,'-m','m','hi'],{cwd:proj,env:{PATH:process.env.PATH,HOME:home,CODEX_HOME:ch,K:'k',NO_PROXY:'127.0.0.1',HTTPS_PROXY:'http://127.0.0.1:1'},stdio:['ignore','ignore','ignore']});c.on('close',res);});srv.close();
const roots=Object.fromEntries((raw.match(/`r\d+` = `[^`]+`/g)||[]).map(s=>{const m=/`(r\d+)` = `([^`]+)`/.exec(s);return [m[1],m[2].replace(root,'<root>')];}));
out.codex_duplicate_names={entries:[...raw.matchAll(/- (dup): (DESC-[A-Z-]+)[^(]*\(file: (r\d+)\//g)].map(m=>({desc:m[2],root:roots[m[3]]}))};
// ---- self-loop & conflict logic (scanner classification)
const LIB=join(root,'willyou-managed.json');const managed={};// name -> {source,targets[]}
const tgt=join(root,'claude-iso/skills');mkdirSync(tgt,{recursive:true});sk(src,'alpha','SRC');sk(tgt,'beta','USER-OWN-IN-TARGET');
function link(name,source,targetRoot){const dst=join(targetRoot,name);if(existsSync(dst)||(()=>{try{lstatSync(dst);return true}catch{return false}})()){const st=lstatSync(dst);const ours=st.isSymbolicLink()&&managed[name]?.source===realpathSync(source);return ours?{action:'already'}:{action:'conflict',reason:'目标已有同名项，不覆盖'};}
 symlinkSync(source,dst);(managed[name]??={source:realpathSync(source),targets:[]}).targets.push(dst);writeFileSync(LIB,JSON.stringify(managed));return {action:'linked'};}
function scan(dir){return readdirSync(dir).filter(n=>!n.startsWith('.')).map(n=>{const p=join(dir,n),st=lstatSync(p);const isLink=st.isSymbolicLink();const dangling=isLink&&!existsSync(p);const ours=isLink&&managed[n]?.targets.includes(p);return {name:n,isLink,dangling,classification:ours?(dangling?'managed-dangling→清理':'managed（不再纳管）'):'external-candidate'};});}
out.link_alpha=link('alpha',join(src,'alpha'),tgt);out.link_alpha_again=link('alpha',join(src,'alpha'),tgt);sk(src,'beta','SRC-BETA');out.link_beta_conflict=link('beta',join(src,'beta'),tgt);
out.scan_target=scan(tgt);
const fs=await import('node:fs');fs.rmSync(join(src,'alpha'),{recursive:true});out.scan_after_source_removed=scan(tgt);
console.log(JSON.stringify(out,null,1).replaceAll(root,'<root>'));
