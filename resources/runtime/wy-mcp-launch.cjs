'use strict';
// WillYou managed MCP transport. Public plan + process-only private slots; no shell or eval.
// Parent-owned CLI lifecycle and native integration are validated separately.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const credentialNames = new Set(['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','GEMINI_API_KEY','GOOGLE_API_KEY','DEEPSEEK_API_KEY','ELECTRON_RUN_AS_NODE']);
const fail = (code, message) => { process.stderr.write('MCP launcher: ' + message + '\n'); process.exit(code); };
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value, required, optional=[]) {
  if (!obj(value) || required.some(k => !Object.hasOwn(value,k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) fail(64,'invalid public plan structure');
}
function name(value) { if (typeof value !== 'string' || !NAME.test(value)) fail(64,'invalid environment name'); }
if (process.argv.length !== 4 || process.argv[2] !== '--plan') fail(64,'expected exact --plan PATH');
const path = process.argv[3];
let fd, plan;
try {
  // O_NOFOLLOW prevents replacing the public plan with a symlink between stat/read.
  fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.size > 256*1024 || (st.mode & 0o777) !== 0o600 || process.getuid && st.uid !== process.getuid()) fail(64,'public plan identity or mode invalid');
  plan = JSON.parse(fs.readFileSync(fd,'utf8'));
} catch { fail(64,'public plan unavailable or invalid'); }
finally { if (fd !== undefined) fs.closeSync(fd); }
exact(plan,['version','mode','serverId'],['command','args','cwd','ownEnv','stripNames','headers']);
if (plan.version !== 1 || !['spawn','headers'].includes(plan.mode) || typeof plan.serverId !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(plan.serverId)) fail(64,'invalid plan identity');
function value(reference) {
  if (!obj(reference) || Object.keys(reference).length !== 1) fail(64,'invalid argument reference');
  if (Object.hasOwn(reference,'literal')) { if(typeof reference.literal !== 'string' || reference.literal.includes('\0')) fail(64,'invalid literal'); return reference.literal; }
  if (!Object.hasOwn(reference,'slot') || typeof reference.slot !== 'string' || !new RegExp('^WY_MCPV_'+plan.serverId+'_[1-9][0-9]*$').test(reference.slot)) fail(64,'foreign or invalid private slot');
  if (!Object.hasOwn(process.env,reference.slot)) fail(65,'missing private slot');
  return process.env[reference.slot];
}
if (plan.mode === 'headers') {
  if (!obj(plan.headers) || Object.keys(plan).some(k => !['version','mode','serverId','headers'].includes(k))) fail(64,'invalid header plan');
  const headers=Object.create(null);
  for (const [key,ref] of Object.entries(plan.headers)) { if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)) fail(64,'invalid header name'); const resolved=value(ref); if(/[\r\n]/.test(resolved)) fail(64,'invalid header value'); headers[key]=resolved; }
  process.stdout.write(JSON.stringify(headers),()=>process.exit(0));
} else {
if (typeof plan.command !== 'string' || !plan.command || plan.command.includes('\0') || !Array.isArray(plan.args) || plan.args.length > 4096 || typeof plan.cwd !== 'string' || !obj(plan.ownEnv) || !Array.isArray(plan.stripNames) || Object.hasOwn(plan,'headers')) fail(64,'invalid spawn plan');
const args=plan.args.map(value), own=Object.create(null), strip=new Set(credentialNames);
for (const key of plan.stripNames) { name(key); strip.add(key); }
for (const [key,reference] of Object.entries(plan.ownEnv)) { name(key); if(key.startsWith('WY_MCPV_')) fail(64,'private-slot own variable forbidden'); own[key]=value(reference); }
// Data is never assigned to this process.env or to launcher control variables.
const env=Object.create(null);
for (const [key,val] of Object.entries(process.env)) if(!strip.has(key) && !key.startsWith('WY_MCPV_') && !key.startsWith('WILLYOU_') && !key.startsWith('SMARTDD_')) env[key]=val;
for (const [key,val] of Object.entries(own)) env[key]=val;
let child, closed=false, fallback, requestedSignal;
function signalExit(signal) {
  const number=os.constants.signals[signal];
  if(!number) { process.exitCode=1; return; }
  process.removeAllListeners(signal);
  process.kill(process.pid,signal);
}
function forward(signal) {
  if(closed || !child?.pid)return;
  requestedSignal=signal;
  try { process.platform==='win32' ? child.kill(signal) : process.kill(-child.pid,signal); } catch {}
  if (!fallback) fallback=setTimeout(()=>{ if(!closed)try{process.platform==='win32'?child.kill('SIGKILL'):process.kill(-child.pid,'SIGKILL');}catch{} },1500);
}
try { child=spawn(plan.command,args,{cwd:plan.cwd,env,stdio:'inherit',detached:process.platform!=='win32'}); }
catch { fail(70,'child failed to start'); }
for(const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal,()=>forward(signal));
child.once('error',()=>{ process.stderr.write('MCP launcher: child failed to start\n'); });
child.once('close',(code,signal)=>{
  closed=true;if(fallback)clearTimeout(fallback);
  if(signal)signalExit(signal);
  else process.exitCode=typeof code==='number' && code>=0?code:70;
});

}
