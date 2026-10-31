// Regression for CZ SIGTERM hang. Actual child process, production runtime; no App UI.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationToolService } from '../../../src/main/core/applications/tool-service';
import { PrivateApplicationBroker } from '../../../src/main/core/applications/private-broker';
import { MacProcessIdentityReader } from '../../../src/main/core/applications/process-identity';
import { runFixture } from '../../../src/main/core/applications/__tests__/run-fixture';
let build: string, bundle: Buffer, reader: MacProcessIdentityReader;
describe.skipIf(process.platform !== 'darwin')('standalone CJS bridge through actual MCP stdio SDK and private host broker', () => {
  beforeAll(() => { build = mkdtempSync(join(tmpdir(),'willyou-m10-mcp-build-')); execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',build],{ env: { ...process.env,ELECTRON_RUN_AS_NODE: '1' },timeout: 30000,stdio: 'pipe' }); bundle = readFileSync(process.env.WILLYOU_TEST_BRIDGE_BUNDLE ?? join(build,'mcp-bridge.cjs')); execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'identity')]); reader = new MacProcessIdentityReader(join(build,'identity')); });
  afterAll(() => rmSync(build,{ recursive: true,force: true }));
  it('exits on SIGTERM while its real MCP client keeps stdin open', async () => {
    const f = await runFixture(reader,{ application: true,runtime: bundle }); let cli: ChildProcess | undefined, transport: StdioClientTransport | undefined, broker: PrivateApplicationBroker | undefined; const client = new Client({ name: 'isolated-m10-acceptance-fixture',version: '1.0.0' }); let calls = 0;
    try {
      const run = await f.create(); await run.prepare(); await run.cli.arm(); cli = spawn(process.execPath,['-e','setInterval(() => {}, 10000)'],{ cwd: f.home,env: { HOME: f.home,ELECTRON_RUN_AS_NODE: '1' },stdio: 'ignore' }); await once(cli,'spawn'); await run.cli.attach(cli.pid!);
      const tools = new ApplicationToolService(f.store,f.runs,{ resolve: (_hash,name) => ({ semantics: name.includes('_write_') ? 'write' : 'read',retry: 'never',authorize: () => undefined,execute: async (context,args,operation) => { calls++; return { value: String(args.value),packageHash: operation.packageHash,projectId: context.run.projectId,taskId: context.run.taskId,operationId: operation.operationId }; } }) }); broker = new PrivateApplicationBroker(f.runs,tools); await broker.start(); const prepared = await broker.prepare(run,f.snapshot.mcp[0].serverName); await prepared.bridge.arm();
      const bridgeEntry = join(f.store.root,'runtime',f.snapshot.packages[0].runtimeHash,'mcp-bridge.cjs'); transport = new StdioClientTransport({ command: process.execPath,args: [bridgeEntry,'--bootstrap',prepared.bootstrapPath],cwd: f.home,env: { HOME: f.home,ELECTRON_RUN_AS_NODE: '1' },stderr: 'pipe' }); let stderr = ''; transport.stderr?.on('data',bytes => { stderr += bytes.toString(); }); await client.connect(transport); await prepared.bridge.attach(transport.pid!);
      const childIdentity = reader.read(transport.pid!)!;
      const direct = await client.callTool({ name: 'smartdd_zentao_query_v1',arguments: { value: 'before-tools-list' } }); expect(direct.isError).not.toBe(true); expect(direct.structuredContent).toMatchObject({ packageHash: f.application!.packageHash,projectId: 'p1' });
      const listed = await client.listTools(); expect(listed.tools).toHaveLength(2); expect(listed.tools[0].annotations).toMatchObject({ readOnlyHint: true,destructiveHint: false }); expect(listed.tools[1].annotations).toMatchObject({ readOnlyHint: false,idempotentHint: false }); expect(existsSync(prepared.bootstrapPath)).toBe(false);
      const result = await client.callTool({ name: 'smartdd_zentao_query_v1',arguments: { value: 'through-real-stdio' } }); expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject({ value: 'through-real-stdio',projectId: 'p1',taskId: f.snapshot.taskId,packageHash: f.application!.packageHash }); expect(calls).toBe(2);
      const invalid = await client.callTool({ name: 'smartdd_zentao_query_v1',arguments: { value: 'x',projectId: 'outside' } }); expect(invalid.isError).toBe(true); expect(calls).toBe(2); expect(stderr).not.toMatch(/token|secret|bootstrap/i);
      process.kill(transport.pid!,'SIGTERM'); await vi.waitFor(() => expect(reader.state(childIdentity)).toBe('stopped'),{timeout:2000}); await client.close(); await prepared.bridge.exited(); const cliExit = once(cli,'exit'); cli.kill('SIGTERM'); await cliExit; await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopped');
    } finally { await client.close().catch(() => undefined); if (cli && cli.exitCode === null && cli.signalCode === null) { const done = once(cli,'exit'); cli.kill('SIGKILL'); await done; } await broker?.close(); f.cleanup(); }
  },30000);

});
