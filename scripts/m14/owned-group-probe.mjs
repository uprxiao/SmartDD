// Native drain evidence for an exact detached test launch. No global process enumeration or model call.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const helper = process.argv[2], output = process.argv[3]; assert(helper && output);
const probe = args => JSON.parse(execFileSync(helper, args, { encoding: 'utf8', timeout: 2000 }));
const pause = ms => new Promise(r => setTimeout(r, ms));
const root = spawn(process.execPath, ['-e', `const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(JSON.stringify({childPid:c.pid}));process.stdin.once('data',()=>process.exit(0));`], { detached: true, stdio: ['pipe','pipe','pipe'] });
const result = { helperSha256: createHash('sha256').update(readFileSync(helper)).digest('hex'), rootPid: root.pid, assertions: [] };
let child;
try {
  const identity = probe([String(root.pid)]); assert.equal(identity.state, 'running');
  const line = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('test child did not register')), 5000); root.stdout.once('data', b => { clearTimeout(timer); resolve(b.toString()); }); });
  const { childPid } = JSON.parse(line); const group = probe(['--owned-process-group', String(root.pid), identity.startedAt]);
  assert.equal(group.state, 'running'); assert(group.processes.some(p => p.pid === root.pid)); child = group.processes.find(p => p.pid === childPid); assert(child); result.initial = group; result.assertions.push('exact detached root and its live descendant are listed');
  assert.equal(probe(['--owned-process-group', String(root.pid), 'darwin-proc-v1:1:1']).state, 'unknown'); result.assertions.push('wrong root birth is rejected');
  const exited = new Promise(resolve => root.once('exit', (code, signal) => resolve({ code, signal }))); root.stdin.end('exit'); result.rootExit = await exited;
  const remaining = probe(['--owned-process-group', String(root.pid), identity.startedAt]); assert.equal(remaining.state, 'running'); assert(remaining.processes.some(p => p.pid === child.pid)); result.afterRootExit = remaining; result.assertions.push('root exit alone does not prove group drained');
  assert.deepEqual(probe([String(child.pid)]), { schema: 1, state: 'running', ...child }); process.kill(child.pid, 'SIGTERM');
  const deadline = Date.now() + 5000; let end;
  do { end = probe(['--owned-process-group', String(root.pid), identity.startedAt]); if (end.state === 'stopped') break; await pause(50); } while (Date.now() < deadline);
  assert.equal(end.state, 'stopped'); assert.deepEqual(end.processes, []); result.afterAllExit = end; result.assertions.push('only independently observed empty group is drained'); result.passed = true;
} catch (e) { result.error = String(e.stack ?? e); process.exitCode = 1; }
finally { if (root.exitCode === null && root.signalCode === null) root.kill('SIGTERM'); if (child) { const now = probe([String(child.pid)]); if (now.state === 'running' && now.startedAt === child.startedAt) process.kill(child.pid, 'SIGTERM'); } writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); }
