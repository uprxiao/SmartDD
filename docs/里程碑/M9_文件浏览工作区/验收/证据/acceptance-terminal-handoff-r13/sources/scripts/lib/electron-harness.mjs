// Reuses the M4 CDP approach against our own Electron application.
// Each caller supplies a private userData directory. No global app state is edited.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openElectron({ userData, env: extraEnv = {}, executable, cwd = process.cwd(), inspectMain = false }) {
  const listener = createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const env = { ...process.env, SMARTDD_USER_DATA: userData, ...extraEnv };
  for (const name of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_)/.test(name)) delete env[name];
  const child = spawn(executable ? resolve(executable) : require('electron'), [
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, ...(inspectMain ? ['--inspect=127.0.0.1:0'] : []), ...(executable ? [] : ['.']),
  ], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (b) => { logs += b; });
  child.stderr.on('data', (b) => { logs += b; });
  let ws;
  try {
    let page;
    for (let i = 0; i < 150; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page'); } catch { /* starting */ }
      if (page) break;
      if (child.exitCode !== null) throw new Error('Electron exited before opening its test window');
      await pause(100);
    }
    assert(page, 'Electron debugging target not ready');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let seq = 0;
    const pending = new Map();
    const rendererErrors = [];
    ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer); pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') rendererErrors.push(message.params.exceptionDetails.text);
    });
    const cdp = (method, params = {}, timeoutMs = 25_000) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Electron ${method} timed out`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    await cdp('Runtime.enable');
    const evaluate = async (expression, timeoutMs) => {
      const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, ms = 10_000) => {
      const started = Date.now();
      while (Date.now() - started < ms) { if (await evaluate(expression)) return; await pause(100); }
      // Expressions may contain test parameters; never echo them on failure.
      throw new Error('Electron test condition timed out');
    };
    await waitFor('Boolean(window.electronAPI && document.querySelector("[data-testid=nav-settings]"))');
    await evaluate(`window.__m5 = { output: {}, exits: {} };
      window.electronAPI.eventOn('pty:data', e => { window.__m5.output[e.ptyId] = (window.__m5.output[e.ptyId] || '') + e.data; });
      window.electronAPI.eventOn('pty:exit', e => { window.__m5.exits[e.ptyId] = e.code; }); true`);
    const invoke = (channel, ...args) => evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`, 70_000);
    // Test-only main-process evaluation. Enabled solely by the local launch flag above.
    // Used to compare decrypted credentials with artifacts without returning the credentials.
    const mainEvaluate = async (expression) => {
      assert(inspectMain, 'Main inspection was not enabled for this test instance');
      const url = /Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(logs)?.[1];
      assert(url, 'Main inspector unavailable');
      const socket = new WebSocket(url);
      await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Main inspection timed out')), 25_000);
          socket.addEventListener('message', ({ data }) => {
            const m = JSON.parse(data); if (m.id !== 1) return; clearTimeout(timer);
            if (m.error || m.result.exceptionDetails) reject(new Error('Credential audit could not complete inside the main process'));
            else resolve(m.result.result.value);
          });
          socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
        });
      } finally { socket.close(); }
    };
    return {
      cdp, evaluate, mainEvaluate, waitFor, invoke, rendererErrors,
      output: (ptyId) => evaluate(`window.__m5.output[${JSON.stringify(ptyId)}] || ''`),
      input: (ptyId, data) => evaluate(`window.electronAPI.eventSend('pty:input', ${JSON.stringify({ ptyId, data })})`),
      screenshot: async (path) => { const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 }); },
      logs: () => logs,
      close: async () => {
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Electron test closed')); }
        pending.clear(); ws.close();
        if (child.exitCode === null) {
          const done = new Promise((r) => child.once('exit', r));
          child.kill('SIGTERM');
          await Promise.race([done, pause(3000)]);
          if (child.exitCode === null) child.kill('SIGKILL');
        }
      },
    };
  } catch (error) { ws?.close(); child.kill('SIGKILL'); throw error; }
}
