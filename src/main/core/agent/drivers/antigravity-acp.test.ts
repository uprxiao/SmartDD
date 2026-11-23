import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { antigravityAcpDriver, antigravityArgs, inspectAntigravity, previewAntigravityModels } from './antigravity-acp';
import type { DriverEvent, DriverInstance, TurnStatus } from '../driver';

const executable = process.env.SMARTDD_F35_AGY_BIN;
const carbon = 'gemini-4-carbon';
const argon = 'gemini-4-argon';

function finished(driver: DriverInstance) {
  return new Promise<{ status: TurnStatus; answer: string; error?: string; limitNotice?: unknown }>((resolve, reject) => {
    let answer = '';
    let limitNotice: unknown;
    const release = driver.on((event: DriverEvent) => {
      if (event.type === 'message.delta') answer += event.text;
      if (event.type === 'item.completed' && event.itemType === 'acpError') limitNotice = event.payload;
      if (event.type === 'turn.completed') {
        clearTimeout(timer);
        release();
        resolve({ status: event.status, answer, error: event.error, limitNotice });
      }
    });
    const timer = setTimeout(() => { release(); reject(new Error('ACP 回合未返回终态')); }, 12_000);
  });
}

test.skipIf(!executable)('real agy negotiates ACP, applies model options, resumes and distinguishes a native failure from ordinary text', async () => {
  const home = await mkdtemp(join(tmpdir(), 'willyou-f35-native-test-'));
  const requests: { model: string; history: string }[] = [];
  const server = createServer(async (req, res) => {
    const model = /^\/v1beta\/models\/(gemini-4-(?:carbon|argon)):streamGenerateContent$/.exec(new URL(req.url!, 'http://localhost').pathname)?.[1];
    if (!model || req.headers['x-goog-api-key'] !== 'F35-LOCAL-ONLY') { res.writeHead(403).end(); return; }
    let body = '';
    for await (const bytes of req) body += bytes;
    const contents = JSON.parse(body).contents;
    const history = JSON.stringify(contents);
    requests.push({ model, history });
    const latest = JSON.stringify(contents.at(-1));
    const failure = latest.includes('TEST-WY-BAD-KEY') ? { code: 401, status: 'UNAUTHENTICATED' } :
      latest.includes('TEST-WY-FAIL') ? { code: 400, status: 'INVALID_ARGUMENT' } : undefined;
    if (failure) {
      res.writeHead(failure.code, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: { ...failure, message: 'Synthetic F35 channel failure' },
      }));
      return;
    }
    const latestFixtureCommand = JSON.stringify(contents.findLast((row: { role?: string }) =>
      row.role === 'user' && /TEST-WY-(?:OUTPUT-LIMIT|CONTROL-PHRASE)/.test(JSON.stringify(row))) ?? {});
    const outputLimited = latestFixtureCommand.includes('TEST-WY-OUTPUT-LIMIT');
    const text = outputLimited ? 'WY-PARTIAL-OUTPUT' : latestFixtureCommand.includes('TEST-WY-CONTROL-PHRASE')
      ? 'Output retries exhausted after 4 attempts is ordinary model text.'
      : history.includes('WY-RANDOM-F35') ? 'Error 400 is ordinary text. WY-RANDOM-F35' : 'No history';
    const result = { candidates: [{ index: 0, content: { role: 'model', parts: [{ text }] }, finishReason: outputLimited ? 'MAX_TOKENS' : 'STOP' }], modelVersion: model };
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify(result)}\n\n`);
  });
  let driver: DriverInstance | undefined;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务没有 TCP 地址');
    const blockedProxy = 'http://127.0.0.1:1';
    const base = { HOME: home, TMPDIR: home, XDG_CACHE_HOME: home, XDG_CONFIG_HOME: home, XDG_DATA_HOME: home,
      PATH: '/usr/bin:/bin', HTTP_PROXY: blockedProxy, HTTPS_PROXY: blockedProxy, NO_PROXY: '127.0.0.1' };
    expect(await inspectAntigravity(executable!, home, base)).toEqual({ basic: true, resume: true, mcp: true });
    const options = {
      executable: { path: executable!, version: 'protocol-probed' }, cwd: home, model: carbon, tier: 'ask' as const,
      extraArgs: antigravityArgs(join(home, '.gemini')),
      env: { ...base, GEMINI_API_KEY: 'F35-LOCAL-ONLY', GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${address.port}` },
    };
    const catalog = await previewAntigravityModels(options, [carbon, argon]);
    expect(catalog.map(model => model.id)).toEqual([carbon, argon]);
    expect(catalog.every(model => model.efforts.includes('high'))).toBe(true);
    driver = antigravityAcpDriver.create();
    const opened = await driver.open(options);
    const send = async (text: string, model = carbon) => {
      const end = finished(driver!);
      await driver!.startTurn({ text, model, effort: 'high', tier: 'ask', clientInputId: String(requests.length) });
      return end;
    };
    expect((await send('Remember WY-RANDOM-F35')).status).toBe('completed');
    expect((await send('What was the code?', argon)).answer).toContain('WY-RANDOM-F35');
    expect(requests.at(-1)?.model).toBe(argon);
    expect(await send('TEST-WY-FAIL')).toMatchObject({ status: 'failed', error: expect.stringContaining('HTTP 400') });
    expect(await send('TEST-WY-BAD-KEY')).toMatchObject({ status: 'failed', error: expect.stringContaining('HTTP 401') });
    await driver.close();
    driver = antigravityAcpDriver.create();
    expect((await driver.open({ ...options, resumeNativeId: opened.nativeId })).nativeId).toBe(opened.nativeId);
    const followup = await send('Recall the code.');
    expect(followup.status).toBe('completed');
    expect(followup.answer).toContain('Error 400 is ordinary text. WY-RANDOM-F35');
    expect(requests.at(-1)?.model).toBe(carbon);
    const limited = await send('TEST-WY-OUTPUT-LIMIT');
    expect(limited).toMatchObject({ status: 'failed', error: expect.stringContaining('输出上限'),
      answer: expect.stringContaining('WY-PARTIAL-OUTPUT'), limitNotice: { limited: { kind: 'output' } } });
    expect(await send('TEST-WY-CONTROL-PHRASE')).toMatchObject({ status: 'completed',
      answer: expect.stringContaining('Output retries exhausted'), limitNotice: undefined });
  } finally {
    await driver?.close();
    if (server.listening) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    await rm(home, { recursive: true, force: true });
  }
}, 45_000);
