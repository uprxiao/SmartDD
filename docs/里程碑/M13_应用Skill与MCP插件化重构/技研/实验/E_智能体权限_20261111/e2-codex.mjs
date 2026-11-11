// 补验 E · E2：Codex 0.166.0 各权限组合在 exec（非交互）下的放行范围（用户 GPT 订阅，用户已授权）。
// 默认 CODEX_HOME（订阅登录所在），前后核对 ~/.codex/config.toml 与 auth.json 的哈希不变。
// “完全访问”（--dangerously-bypass-approvals-and-sandbox）不在本机实跑：本机安全检查拒绝启动无沙箱、无批准的 Agent，只做参数与文档核对。
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import os from 'node:os';
const root=process.argv[2]; const outsideRoot=process.argv[3];
const h=f=>existsSync(f)?createHash('sha256').update(readFileSync(f)).digest('hex').slice(0,16):null;
const cx=join(os.homedir(),'.codex'); const before={config:h(join(cx,'config.toml')),auth:h(join(cx,'auth.json'))};
const combos={
  'config默认（不传参数）':[],
  '请求批准 -s workspace-write -a on-request':['-s','workspace-write','-a','on-request'],
  '帮我批准 --approve-for-me':['--approve-for-me'],
  '只读 -s read-only':['-s','read-only'],
};
const out={cli:spawnSync('codex',['--version'],{encoding:'utf8'}).stdout.trim(),login:spawnSync('codex',['login','status'],{encoding:'utf8'}).stderr.split('\n').filter(l=>/Logged|Not logged|API key/.test(l)).join(' '),runs:{}};
let i=0;
for(const [label,flags] of Object.entries(combos)){
  i++; const proj=join(root,'proj-'+i), outside=join(outsideRoot,'outside-'+i); mkdirSync(proj,{recursive:true}); mkdirSync(outside,{recursive:true});
  const prompt=`Do these steps in order using shell commands, continue even if one fails, do not ask me anything:
1. Create ${join(proj,'in-cwd.txt')} containing "a".
2. Create ${join(outside,'outside.txt')} containing "c".
3. Run: curl -s -o /dev/null -w "%{http_code}" https://example.com
Finally reply with one line per step: done or failed, with the reason.`;
  const t=Date.now(); const r=spawnSync('codex',['exec','--skip-git-repo-check','--json','-C',proj,...flags,prompt],{encoding:'utf8',timeout:300000});
  const events=(r.stdout||'').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  const cmds=events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution').map(e=>({cmd:(e.item.command||'').slice(0,200),exit:e.item.exit_code,status:e.item.status,out:(e.item.aggregated_output||'').slice(0,200)}));
  const last=[...events].reverse().find(e=>e.type==='item.completed'&&e.item?.type==='agent_message');
  out.runs[label]={flags,exit:r.status,ms:Date.now()-t,files:{inCwd:existsSync(join(proj,'in-cwd.txt')),outside:existsSync(join(outside,'outside.txt'))},commands:cmds,final:(last?.item?.text||'').slice(0,600),
    stderrTail:(r.stderr||'').split('\n').filter(l=>l&&!/^\s*$/.test(l)).slice(-3).join(' / ').slice(0,400),eventTypes:[...new Set(events.map(e=>e.type+(e.item?.type?':'+e.item.type:'')))]};
  console.error(label, JSON.stringify(out.runs[label].files), r.status, out.runs[label].ms+'ms');
  writeFileSync(join(root,'e2-result.json'),JSON.stringify({...out,before},null,1));
}
out.before=before; out.after={config:h(join(cx,'config.toml')),auth:h(join(cx,'auth.json'))}; out.globalUnchanged=out.before.config===out.after.config&&out.before.auth===out.after.auth;
writeFileSync(join(root,'e2-result.json'),JSON.stringify(out,null,1));
