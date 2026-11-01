import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ExperimentBroker } from './broker.mjs';
const here = dirname(fileURLToPath(import.meta.url)), cli = join(here, 'cli.mjs');
const results = []; const rec = (id, ok, note) => { results.push({ id, ok, note }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + note); };
const call = (env, args) => new Promise(res => { const p = spawn(process.execPath, [cli, ...args], { env }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); p.on('close', code => res({ code, o, e, pid: p.pid })); });
const broker = new ExperimentBroker(); await broker.start();
const A = broker.issue('A', ['read']), B = broker.issue('B', ['read', 'write']);
const envOf = r => ({ PATH: process.env.PATH, WILLYOU_RUN_TOKEN: r.token, WILLYOU_ENDPOINT: broker.endpoint });
// E1 连续与并行多个子进程均被识别为同一运行
const seq = []; for (let i = 0; i < 3; i++) seq.push(await call(envOf(A), ['bug.list']));
const par = await Promise.all(Array.from({ length: 6 }, () => call(envOf(A), ['bug.list'])));
const okAll = [...seq, ...par].every(r => r.code === 0 && JSON.parse(r.o).project === 'A');
rec('E1', okAll && broker.calls.filter(c => c.runId === A.runId && c.ok).length === 9, '3连续+6并行共9个子进程均识别为运行A，返回项目A数据');
// E2 参数中的项目不能授权
const x = await call(envOf(A), ['bug.list', '--project', 'B']);
rec('E2', x.code === 2 && JSON.parse(x.o).code === 'SCOPE_DENIED', '运行A自报--project B被拒绝，且无B数据');
// E3 权限上限：只读身份不能写；有写权限的B可以
const w1 = await call(envOf(A), ['bug.write']), w2 = await call(envOf(B), ['bug.write']);
rec('E3', JSON.parse(w1.o).code === 'PERMISSION_DENIED' && JSON.parse(w2.o).ok === true, '只读运行写被拒；授予写的运行可写');
// E4 缺失/伪造令牌
const noTok = await call({ PATH: process.env.PATH }, ['bug.list']);
const fake = await call({ ...envOf(A), WILLYOU_RUN_TOKEN: 'f'.repeat(64) }, ['bug.list']);
rec('E4', noTok.code === 3 && JSON.parse(fake.o).code === 'UNAUTHENTICATED', '无上下文CLI直接拒绝；伪造令牌被宿主拒绝');
// E5 令牌不出现在参数、stdout、stderr
const leak = [...seq, ...par, x, w1, w2, noTok, fake].some(r => r.o.includes(A.token) || r.e.includes(A.token) || r.o.includes(B.token));
rec('E5', !leak, 'CLI 输出与诊断中无令牌；令牌仅经环境传入（CLI 不接受令牌参数）');
// E6 撤销后旧身份失效，新运行可用，旧令牌不复活
broker.revoke(A.runId);
const after = await call(envOf(A), ['bug.list']); const A2 = broker.issue('A', ['read']); const fresh = await call(envOf(A2), ['bug.list']);
const again = await call(envOf(A), ['bug.list']);
rec('E6', JSON.parse(after.o).code === 'REVOKED' && JSON.parse(fresh.o).ok && JSON.parse(again.o).code === 'REVOKED', '撤销后旧令牌REVOKED；新运行可用；旧令牌不复活');
// E7 过期
const C = broker.issue('A', ['read'], 1); await new Promise(r => setTimeout(r, 20));
const exp = await call(envOf(C), ['bug.list']);
rec('E7', JSON.parse(exp.o).code === 'EXPIRED', '过期令牌被拒绝');
// E8 环境暴露观察（威胁模型）：同一用户的另一个进程能否读到受管终端的环境令牌
const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{},4000)'], { env: envOf(B) });
await new Promise(r => setTimeout(r, 300));
let seen = false, how = '';
try { const out = execFileSync('ps', ['eww', '-p', String(holder.pid)], { encoding: 'utf8' }); seen = out.includes(B.token); how = 'ps eww'; } catch (e) { how = 'ps失败:' + e.message.slice(0, 60); }
holder.kill();
rec('E8', true, `观察项（非通过判据）：同用户进程用 ${how} ${seen ? '能' : '不能'}读到目标进程环境令牌`);
// E9 对端PID：Node net 无法取得 Unix socket 对端 PID/UID（记录能力边界）
rec('E9', true, '观察项：Node net 未暴露 SO_PEERCRED/LOCAL_PEERPID，宿主无法用对端PID验证调用者；身份只能依赖运行级令牌');
await broker.close();
const pass = results.filter(r => r.ok).length;
const out = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform + '/' + process.arch, results, summary: `${pass}/${results.length}` };
writeFileSync(join(here, 'result.json'), JSON.stringify(out, null, 2) + '\n');
console.log('summary', out.summary); process.exit(results.every(r => r.ok) ? 0 : 1);
