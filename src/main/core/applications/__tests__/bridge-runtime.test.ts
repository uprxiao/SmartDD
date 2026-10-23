import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationToolService } from '../tool-service';
import { PrivateApplicationBroker } from '../private-broker';
import { MacProcessIdentityReader } from '../process-identity';
import { runFixture } from './run-fixture';
let build: string, bundle: Buffer, reader: MacProcessIdentityReader;
describe.skipIf(process.platform !== 'darwin')('standalone CJS bridge through actual MCP stdio SDK and private host broker', () => {
  beforeAll(() => { build = mkdtempSync(join(tmpdir(),'willyou-m10-mcp-build-')); execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',build],{ env: { ...process.env,ELECTRON_RUN_AS_NODE: '1' },timeout: 30000,stdio: 'pipe' }); bundle = readFileSync(join(build,'mcp-bridge.cjs')); execFileSync('xcrun',['clang++','-std=c++17','-O2',resolve('native/applications/process-identity.cc'),'-o',join(build,'identity')]); reader = new MacProcessIdentityReader(join(build,'identity')); });
  afterAll(() => rmSync(build,{ recursive: true,force: true }));
  it('launches immutable CJS with Electron Node, preserves fixed annotations/schemas and records the host-derived invocation', async () => {
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
      await client.close(); await vi.waitFor(() => expect(reader.state(childIdentity)).toBe('stopped')); await prepared.bridge.exited(); const cliExit = once(cli,'exit'); cli.kill('SIGTERM'); await cliExit; await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopped');
    } finally { await client.close().catch(() => undefined); if (cli && cli.exitCode === null && cli.signalCode === null) { const done = once(cli,'exit'); cli.kill('SIGKILL'); await done; } await broker?.close(); f.cleanup(); }
  },30000);

  it('rejects raw MCP requests before initialization and recovers from invalid stdio frames without business calls',async()=>{
    const f=await runFixture(reader,{application:true,runtime:bundle});let cli:ChildProcess|undefined,child:ChildProcess|undefined,broker:PrivateApplicationBroker|undefined;let calls=0;
    try{
      const run = await f.create(); await run.prepare(); await run.cli.arm(); cli = spawn(process.execPath,['-e','setInterval(() => {}, 10000)'],{ cwd: f.home,env: { HOME: f.home,ELECTRON_RUN_AS_NODE: '1' },stdio: 'ignore' }); await once(cli,'spawn'); await run.cli.attach(cli.pid!);
      const tools = new ApplicationToolService(f.store,f.runs,{ resolve: (_hash,name) => ({ semantics: name.includes('_write_') ? 'write' : 'read',retry: 'never',authorize: () => undefined,execute: async (context,args,operation) => { calls++; return { value: String(args.value),packageHash: operation.packageHash,projectId: context.run.projectId,taskId: context.run.taskId,operationId: operation.operationId }; } }) }); broker = new PrivateApplicationBroker(f.runs,tools); await broker.start(); const prepared = await broker.prepare(run,f.snapshot.mcp[0].serverName); await prepared.bridge.arm();

      child=spawn(process.execPath,[join(f.store.root,'runtime',f.snapshot.packages[0].runtimeHash,'mcp-bridge.cjs'),'--bootstrap',prepared.bootstrapPath],{cwd:f.home,env:{HOME:f.home,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','pipe','pipe']});
      await once(child,'spawn');await prepared.bridge.attach(child.pid!);
      const messages:Record<string,unknown>[]=[],lines=createInterface({input:child.stdout!});let stderr='';child.stderr!.on('data',chunk=>stderr+=chunk.toString());lines.on('line',line=>messages.push(JSON.parse(line)));
      let id=0;
      const send=async(method:string,params:unknown)=>{const requestId=++id;child!.stdin!.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');await vi.waitFor(()=>expect(messages.some(x=>x.id===requestId)).toBe(true),{timeout:3000});return messages.find(x=>x.id===requestId)!;};
      child.stdin!.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      const earlyList=await send('tools/list',{});expect(earlyList).toHaveProperty('error');expect(calls).toBe(0);
      const early=await send('tools/call',{name:'smartdd_zentao_query_v1',arguments:{value:'before-initialize'}});expect(early).toHaveProperty('error');expect(calls).toBe(0);
      const initialized=await send('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'raw-protocol-fixture',version:'1.0.0'}});expect(initialized).toHaveProperty('result');const notReady=await send('tools/list',{});expect(notReady).toHaveProperty('error');expect(calls).toBe(0);child.stdin!.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
      child.stdin!.write('{"malformed":"private-canary",\n');
      for(const [method,params] of [['unknown-method',{}],['tools/call',{}],['tools/call',{name:12}],['tools/call',{name:'smartdd_zentao_query_v1',arguments:{value:12}}]] as const){const response=await send(method,params);expect(response.error||(response.result as {isError?:boolean})?.isError).toBeTruthy();expect(calls).toBe(0);}
      const valid=await send('tools/call',{name:'smartdd_zentao_query_v1',arguments:{value:'valid-after-invalid'}});expect(valid).not.toHaveProperty('error');expect((valid.result as {isError?:boolean}).isError).not.toBe(true);expect(calls).toBe(1);
      expect(stderr).not.toContain('private-canary');expect(stderr).not.toMatch(/token|secret|bootstrap/i);
      lines.close();const exited=once(child,'exit');child.stdin!.end();await exited;await prepared.bridge.exited();const cliExit=once(cli!,'exit');cli!.kill('SIGTERM');await cliExit;await run.cli.exited();expect(f.runs.get(run.runId).state).toBe('stopped');
    }finally{for(const process of [child,cli])if(process&&process.exitCode===null&&process.signalCode===null){const done=once(process,'exit');process.kill('SIGKILL');await done;}await broker?.close();f.cleanup();}
  },30000);
  it('terminates a refused real broker handshake without leaving an open socket or printing its ticket', async () => {
    const f = await runFixture(reader,{ application: true,runtime: bundle }); let cli: ChildProcess | undefined, child: ChildProcess | undefined, broker: PrivateApplicationBroker | undefined;
    try {
      const run = await f.create(); await run.prepare(); await run.cli.arm(); cli = spawn(process.execPath,['-e','setInterval(() => {}, 10000)'],{ cwd: f.home,env: { HOME: f.home,ELECTRON_RUN_AS_NODE: '1' },stdio: 'ignore' }); await once(cli,'spawn'); await run.cli.attach(cli.pid!);
      const tools = new ApplicationToolService(f.store,f.runs,{ resolve: () => { throw new Error('refused ticket must not reach executor'); } }); broker = new PrivateApplicationBroker(f.runs,tools); await broker.start(); const prepared = await broker.prepare(run,f.snapshot.mcp[0].serverName); await prepared.bridge.arm(); const bootstrap = JSON.parse(readFileSync(prepared.bootstrapPath,'utf8')); bootstrap.secret = '0'.repeat(64); writeFileSync(prepared.bootstrapPath,JSON.stringify(bootstrap));
      const entry = join(f.store.root,'runtime',f.snapshot.packages[0].runtimeHash,'mcp-bridge.cjs'); child = spawn(process.execPath,[entry,'--bootstrap',prepared.bootstrapPath],{ cwd: f.home,env: { HOME: f.home,ELECTRON_RUN_AS_NODE: '1' },stdio: ['ignore','pipe','pipe'] }); let stdout = '', stderr = ''; child.stdout!.on('data',data => { stdout += data.toString(); }); child.stderr!.on('data',data => { stderr += data.toString(); }); await once(child,'spawn'); await prepared.bridge.attach(child.pid!);
      const [code] = await once(child,'exit',{ signal: AbortSignal.timeout(5000) }); expect(code).toBe(1); expect(stdout).toBe(''); expect(stderr).toBe('WillYou application bridge unavailable\n'); expect(stderr).not.toContain(bootstrap.secret); await prepared.bridge.exited(); const done = once(cli,'exit'); cli.kill('SIGTERM'); await done; await run.cli.exited(); expect(f.runs.get(run.runId).state).toBe('stopped');
    } finally { for (const p of [child,cli]) if (p && p.exitCode === null && p.signalCode === null) { const done = once(p,'exit'); p.kill('SIGKILL'); await done; } await broker?.close(); f.cleanup(); }
  },10000);
  it('fails an invalid external invocation without stdout protocol pollution or sensitive diagnostics', () => {
    let stdout = '', stderr = ''; try { execFileSync(process.execPath,[join(build,'mcp-bridge.cjs'),'--bootstrap',join(build,'not-issued.json')],{ cwd: build,env: { HOME: build,ELECTRON_RUN_AS_NODE: '1' },timeout: 5000,encoding: 'utf8',stdio: ['ignore','pipe','pipe'] }); throw new Error('expected bridge refusal'); }
    catch (error) { const result = error as { status: number;stdout: string;stderr: string }; expect(result.status).toBe(1); stdout = String(result.stdout); stderr = String(result.stderr); }
    expect(stdout).toBe(''); expect(stderr).toBe('WillYou application bridge unavailable\n');
  });
});
