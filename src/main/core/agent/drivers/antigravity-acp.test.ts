import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { antigravityAcpDriver, antigravityArgs, inspectAntigravity, previewAntigravityModels } from './antigravity-acp';
import type { DriverEvent, DriverInstance, DriverOpenOptions, TurnStatus } from '../driver';
import { until } from '../test-doubles';

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

test.skipIf(!executable)('real Agy reads a projected Skill and resumes the same session with a fresh Skill directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'willyou-agy-skill-test-'));
  const cwd = join(home, 'project');
  const nativeDir = join(home, '.gemini');
  const origin = join(home, 'skill-source');
  const name = 'willyou-test-projection';
  const target = join(home, 'run-one', 'agy-gemini', 'skills', name);
  const targetFile = join(target, 'SKILL.md');
  const description = 'WY-FIXTURE-DESCRIPTION-903';
  const instruction = 'WY-FIXTURE-INSTRUCTION-903';
  const requests: { latest: string; advertised: boolean }[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const bytes of req) raw += bytes;
    const payload = JSON.parse(raw);
    const latest = JSON.stringify(payload.contents.at(-1));
    const advertised = JSON.stringify(payload.systemInstruction ?? payload.system_instruction ?? {}).includes(description);
    requests.push({ latest, advertised });
    const part = latest.includes('functionResponse')
      ? { text: latest.includes(instruction) ? 'fixture read' : 'fixture missed' }
      : advertised && /(?:natural|explicit)-probe/.test(latest)
        ? { functionCall: { name: 'read_file', args: { Path: targetFile, StartLine: 1, EndLine: 6 } },
          thoughtSignature: 'd2lsbHlvdS1za2lsbC10ZXN0' }
        : { text: 'fixture done' };
    const response = { candidates: [{ index: 0, content: { role: 'model', parts: [part] }, finishReason: 'STOP' }], modelVersion: carbon };
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify(response)}\n\n`);
  });
  let driver: DriverInstance | undefined;
  try {
    await Promise.all([cwd, origin, dirname(target)].map(path => mkdir(path, { recursive: true })));
    await writeFile(join(origin, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${instruction}\n`);
    await symlink(origin, target, 'dir');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('测试服务没有 TCP 地址');
    const options: DriverOpenOptions = {
      executable: { path: executable!, version: '1.5.14' }, cwd, model: carbon, tier: 'ask',
      extraArgs: antigravityArgs(nativeDir),
      env: { HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin', HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1', GEMINI_API_KEY: 'WY-LOCAL-ONLY',
        GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${address.port}` },
    };
    driver = antigravityAcpDriver.create();
    const opened = await driver.open({ ...options, skillRoots: [{ name, path: target }] });
    const current = driver;
    current.on(event => {
      if (event.type === 'request' && event.kind === 'tool_approval') {
        const approved = JSON.stringify(event.payload).includes(targetFile);
        void current.respond(event.requestKey, { behavior: approved ? 'allow' : 'deny' }).catch(() => {});
      }
    });
    for (const text of ['natural-probe: use the fixture skill', `explicit-probe: read "${targetFile}"\n$${name}`]) {
      const requestOffset = requests.length;
      const turn = finished(driver);
      await driver.startTurn({ clientInputId: text.slice(0, 8), text, tier: 'ask' });
      expect(await turn).toMatchObject({ status: 'completed', answer: 'fixture read' });
      expect(requests.slice(requestOffset)).toContainEqual({ latest: expect.stringContaining(text.slice(0, 8)), advertised: true });
    }
    await driver.close();
    driver = antigravityAcpDriver.create();
    const resumed = await driver.open({ ...options, resumeNativeId: opened.nativeId });
    expect(resumed.nativeId).toBe(opened.nativeId);
    const requestOffset = requests.length;
    const turn = finished(driver);
    await driver.startTurn({ clientInputId: 'resumed', text: 'after-resume', tier: 'ask' });
    expect(await turn).toMatchObject({ status: 'completed', answer: 'fixture done' });
    const resumedRequests = requests.slice(requestOffset);
    expect(resumedRequests.length).toBeGreaterThan(0);
    expect(resumedRequests.every(request => !request.advertised)).toBe(true);
  } finally {
    await driver?.close();
    server.close();
    await rm(home, { recursive: true, force: true });
  }
}, 45_000);

test.skipIf(!executable)('real agy negotiates ACP, applies model options, resumes and distinguishes a native failure from ordinary text', async () => {
  const home = await mkdtemp(join(tmpdir(), 'willyou-f35-native-test-'));
  const requests: { model: string; history: string }[] = [];
  let permissionStep = 0;
  let restoreManual: (() => Promise<void>) | undefined;
  const server = createServer(async (req, res) => {
    const model = /^\/v1beta\/models\/(gemini-4-(?:carbon|argon)):streamGenerateContent$/.exec(new URL(req.url!, 'http://localhost').pathname)?.[1];
    if (!model || req.headers['x-goog-api-key'] !== 'F35-LOCAL-ONLY') { res.writeHead(403).end(); return; }
    let body = '';
    for await (const bytes of req) body += bytes;
    const { contents, tools } = JSON.parse(body);
    const history = JSON.stringify(contents);
    requests.push({ model, history });
    const latest = JSON.stringify(contents.at(-1));
    if (history.includes('TEST-WY-LIVE-PERMISSION') && tools?.some((tool: { functionDeclarations?: { name: string }[] }) =>
      tool.functionDeclarations?.some(decl => decl.name === 'run_command'))) {
      if (permissionStep === 2) await restoreManual?.();
      const marker = ['first', 'second', 'third'][permissionStep++];
      const part = marker ? {
        functionCall: { name: 'run_command', args: { CommandLine: `/usr/bin/awk 'BEGIN { print "${marker}-permission-marker" }'`,
          toolSummary: 'Print permission marker', WaitMsBeforeAsync: 1000 } },
        thoughtSignature: 'cGVybWlzc2lvbi1maXh0dXJl',
      } : { text: 'Three commands completed' };
      const result = { candidates: [{ index: 0, content: { role: 'model', parts: [part] }, finishReason: 'STOP' }], modelVersion: model };
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify(result)}\n\n`);
      return;
    }
    if (latest.includes('TEST-WY-GEMINI-HEADERS')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const firstChunk = {
        candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'Gemini 流式' }] } }],
        modelVersion: model,
        sdkHttpResponse: { headers: {
          'Alt-Svc': 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
          'Content-Type': 'text/event-stream',
          Vary: ['Accept-Encoding'],
        } },
      };
      const lastChunk = {
        candidates: [{ index: 0, content: { role: 'model', parts: [{ text: '回复完整' }] }, finishReason: 'STOP' }],
        modelVersion: model,
        usageMetadata: { trafficType: 'ON_DEMAND' },
      };
      res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);
      res.end(`data: ${JSON.stringify(lastChunk)}\n\n`);
      return;
    }
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
    expect(await send('TEST-WY-GEMINI-HEADERS')).toMatchObject({
      status: 'completed', answer: 'Gemini 流式回复完整', error: undefined,
    });
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
    const approvals: Extract<DriverEvent, { type: 'request' }>[] = [];
    const toolResults: string[] = [];
    const release = driver.on(event => {
      if (event.type === 'request' && event.kind === 'tool_approval') approvals.push(event);
      if (event.type === 'item.completed' && event.itemType === 'acpToolCall') {
        const result = (event.payload as { rawOutput?: { exit_code?: number; output?: string } }).rawOutput;
        if (result?.exit_code === 0 && result.output) toolResults.push(result.output);
      }
    });
    try {
      restoreManual = async () => { await driver!.setTurnTier!('full', 'ask'); };
      const done = send('TEST-WY-LIVE-PERMISSION');
      void done.catch(() => {});
      await until(() => approvals.length === 1, 8000);
      expect(await driver.setTurnTier!('ask', 'full')).toBe(true);
      expect(toolResults).toHaveLength(0);
      await driver.respond(approvals[0].requestKey, { behavior: 'allow' });
      await until(() => approvals.length === 2, 8000);
      expect(JSON.stringify(approvals[1].payload)).toContain('third-permission-marker');
      await driver.respond(approvals[1].requestKey, { behavior: 'allow' });
      expect(await done).toMatchObject({ status: 'completed', answer: expect.stringContaining('Three commands completed') });
      expect(toolResults).toEqual(['first', 'second', 'third'].map(marker => expect.stringContaining(`${marker}-permission-marker`)));
    } finally { release(); }
  } finally {
    await driver?.close();
    if (server.listening) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    await rm(home, { recursive: true, force: true });
  }
}, 45_000);
