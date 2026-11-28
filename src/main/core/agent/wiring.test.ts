import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { providerModelSchema, type CodeAgentTool, type ProviderView, type RunConfigView } from '@shared/ai-agents';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { CapabilityService } from '../capabilities/capability-service';
import { CapabilityRegistryService } from '../capabilities/capability-registry';
import { capabilityScanContexts } from '../capabilities/scan-contexts';
import { SkillProjectionService } from '../capabilities/skill-projection';
import {McpProjectionService} from '../capabilities/mcp-projection';
import {ScheduleService} from '../schedules/service';
import { ProjectService } from '../projects/project-service';
import { secretKeys } from '../projects/secret-keys';
import { evaluateCapabilities, type DriverId } from './capabilities';
import { Emitter, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import { probeAndRecord } from './discovery';
import { DRIVERS } from './registry';
import { createAgentWorkspace, type AgentWorkspaceDeps } from './wiring';

vi.mock('./discovery', async importOriginal => ({
  ...await importOriginal<typeof import('./discovery')>(),
  probeAndRecord: vi.fn(),
}));
vi.mock('./registry', () => ({ DRIVERS: new Map() }));

class RecordingDriver implements DriverInstance {
  private readonly emitter = new Emitter();
  readonly on = this.emitter.on.bind(this.emitter);
  readonly nativeId = randomUUID();
  openOptions?: DriverOpenOptions;
  input?: TurnInput;
  failBeforeFork = false;

  constructor(readonly driverId: DriverId) {}

  async open(options: DriverOpenOptions) {
    this.openOptions = options;
    if (this.failBeforeFork) throw Error('fixture pre-fork failure');
    this.emitter.emit({ type: 'process', pid: 43210 });
    return { nativeId: options.resumeNativeId ?? this.nativeId, confirmed: true };
  }

  async startTurn(input: TurnInput) {
    this.input = input;
    const nativeTurnId = randomUUID();
    this.emitter.emit({ type: 'turn.started', nativeTurnId, clientInputId: input.clientInputId });
    if(input.text.includes('M16-A50-REQUEST-FIXTURE'))this.emitter.emit({type:'request',requestKey:randomUUID(),kind:'command_approval',payload:{command:'echo local fixture'}});
    setImmediate(() => this.emitter.emit({ type: 'turn.completed', nativeTurnId, status: 'completed' }));
    return { nativeTurnId };
  }

  async injectHistory() {}
  async defaultModel() { return 'fixture-model'; }
  async respond() {}
  async interrupt() {}
  async close() {
    if (!this.failBeforeFork) this.emitter.emit({ type: 'exit', code: 0, signal: null });
  }
}

function fixture(kind: 'codex' | 'claude' | 'antigravity', version: string, mcp = false, withProjection = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-project-launch-')));
  const home = join(root, 'home');
  mkdirSync(home);
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys=ON');
  runBundledMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  const secrets = new SecretsStore(db, {
    isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString(),
  });
  const projects = new ProjectService(db, secrets);
  const capabilities = new CapabilityService({ db, projects, secrets, userData: root });
  const project = projects.createProject({ name: 'Current project', aliases: [], description: '', rulesPath: null }, [{ label: 'Work', path: root }]);
  const other = projects.createProject({ name: 'Other project', aliases: [], description: '', rulesPath: null }, []);
  const databaseInput = {
    env: 'test', label: 'Fixture DB', aliases: [], vendor: 'postgres', host: '127.0.0.1', port: 5432,
    database: 'fixture', schema: 'public', username: 'test', accessLevel: 'readonly', isDefault: true, note: '',
  } as const;
  const database = projects.createDatabase(project.id, { ...databaseInput, aliases: [], password: 'fixture-db-credential' });
  projects.createDatabase(other.id, { ...databaseInput, aliases: [], password: 'other-project-credential' });
  const server = projects.createServer(project.id, {
    env: 'test', label: 'Fixture SSH', aliases: [], host: '127.0.0.1', port: 22, username: 'tester',
    authType: 'password', privateKeyPath: null, defaultRoot: false, sudoPolicy: 'none', appRoot: null,
    logsPath: null, note: '', password: 'fixture-ssh-credential',
  });
  const managed = kind === 'antigravity';
  const driverId = managed ? 'antigravity-acp' : kind === 'codex' ? 'codex-app-server' : 'claude-sdk';
  const tool: CodeAgentTool = { id: 'fixture-tool', kind, executable: '/bin/sh', installed: true, login: managed ? 'none' : 'subscription', version };
  const provider: ProviderView = {
    id: 'fixture-provider', name: 'Fixture', preset: null, authType: 'api-key', hasKey: true,
    endpoints: { gemini: 'http://127.0.0.1:9' }, identityRevision: 1,
    models: [providerModelSchema.parse({ id: 'fixture-model', name: 'Fixture model', availability: { antigravity: 'available' } })],
    recommended: {}, refreshedAt: null,
  };
  const config: RunConfigView = {
    id: 'fixture-profile', name: 'Fixture', toolId: tool.id, kind, source: managed ? 'provider' : 'login', providerId: managed ? provider.id : null,
    models: managed ? ['fixture-model'] : [], defaultModel: managed ? 'fixture-model' : null,
    homeVisible: true, isDefault: true, loggedOut: false, nameCustomized: true,
    order: 0, available: true, legacyReason: null,
  };
  const instances: RecordingDriver[] = [];
  const emitted:Parameters<AgentWorkspaceDeps['emitEvent']>[0][]=[];
  let failBeforeFork = false;
  (DRIVERS as Map<DriverId, { id: DriverId; command: string; create(): RecordingDriver }>).set(driverId, {
    id: driverId, command: kind, create: () => {
      const driver = new RecordingDriver(driverId);
      driver.failBeforeFork = failBeforeFork;
      instances.push(driver);
      return driver;
    },
  });
  vi.mocked(probeAndRecord).mockResolvedValue({
    ...evaluateCapabilities(driverId, version, name => name !== 'mcp' || mcp),
    binaryPath: tool.executable, realpath: tool.executable, shellPath: '/usr/bin:/bin',
  });
  const deps = {
    sqlite, capabilities, userData: root,
    agents: { configs: () => [config], tools: () => [tool], providers: () => managed ? [provider] : [] } as unknown as AgentWorkspaceDeps['agents'],
    providers: { runtimeConnection: () => ({ target: { key: 'fixture-gemini-key' }, assertCurrent() {} }) } as unknown as AgentWorkspaceDeps['providers'],
    baseEnv: () => ({
      HOME: home, PATH: '/usr/bin:/bin', PROJECT_DB_CONFIG: '/old/project.json', REMOTE_SERVERS_CONFIG: '/old/servers.json',
      SMARTDD_DB_OLD_PASSWORD: 'inherited-project-credential',
    }),
    processes: {
      read: (pid: number) => ({ pid, startedAt: 'darwin-proc-v1:1:1' }),
      state: () => 'stopped' as const,
      ownedGroup: () => ({ state: 'stopped' as const, processes: [] }),
    },
    host: { instanceId: randomUUID(), pid: process.pid, startedAt: null },
    emitEvent(event:Parameters<AgentWorkspaceDeps['emitEvent']>[0]) {emitted.push(event);}, emitLive() {},
  };
  const skills = new CapabilityRegistryService(db, () => capabilityScanContexts(home, {}, [], [root]));
  const workspace = createAgentWorkspace({ ...deps, capabilityRegistry: skills, skillProjection: new SkillProjectionService(db, skills), ...(withProjection?{mcpProjection:new McpProjectionService(skills,{userData:root,executable:'/fixture/WillYou',launcherSource:'// fixture carrier'})}:{}) });
  const { taskId } = workspace.tasks.create({
    projectId: project.id, dirId: project.dirs[0].id, cwd: root, title: 'Fixture', profileId: config.id, tier: 'ask',
  });
  async function submit(text = 'Read the project fixture') {
    const { turnId } = await workspace.tasks.submit(taskId, {
      clientInputId: randomUUID(), text, expectedSelectionRevision: workspace.tasks.snapshot(taskId).selectionRevision,
    });
    await vi.waitFor(() => expect(['completed', 'failed']).toContain(workspace.store.turn(turnId)?.status));
    return workspace.store.turn(turnId);
  }
  return {
    root, home, workspace, taskId, project, projects, capabilities, database, server, instances, submit, secrets, skills,emitted,
    failBeforeFork() { failBeforeFork = true; },
    async close() { await workspace.closeAll(); capabilities.dispose(); sqlite.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

it('lists enabled Codex skills from the configured user and project directories before starting a run', async () => {
  const f = fixture('codex', '0.171.0');
  try {
    const skill = (root: string, name: string) => {
      const directory = join(root, name);
      mkdirSync(directory, { recursive: true });
      const path = join(directory, 'SKILL.md');
      writeFileSync(path, `---\nname: ${name}\ndescription: Local test skill\n---\n`);
      return path;
    };
    mkdirSync(join(f.root, '.git'));
    skill(join(f.home, '.agents/skills'), 'personal-codex');
    skill(join(f.root, '.agents/skills'), 'project-codex');
    skill(join(f.home, '.claude/skills'), 'personal-claude');
    const disabled = skill(join(f.home, '.codex/skills'), 'disabled-codex');
    writeFileSync(join(f.home, '.codex/config.toml'), `[skills]\nconfig=[{path=${JSON.stringify(disabled)},enabled=false}]\n`);
    const result = f.workspace.homeSkillCatalog(f.project.id, f.project.dirs[0].id, 'fixture-profile', true);
    expect(result.native).toEqual(expect.arrayContaining([{ name: 'personal-codex' }, { name: 'project-codex' }]));
    expect(result.native.some(skill => skill.name === 'personal-claude' || skill.name === 'disabled-codex')).toBe(false);
    expect(f.instances).toHaveLength(0);
  } finally { await f.close(); }
});

it('makes a newly adopted Skill available in Agy and resolves only its scoped dollar reference', async () => {
  const f = fixture('antigravity', '1.5.14');
  try {
    const file = join(f.home, '.claude/skills/cross-agent/SKILL.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '---\nname: cross-agent\ndescription: Run the cross-agent fixture\n---\n');
    expect(f.workspace.homeSkillCatalog(f.project.id, f.project.dirs[0].id, 'fixture-profile', true).managed).toEqual([]);
    f.skills.scan();
    f.skills.adoptAll();
    expect(f.workspace.homeSkillCatalog(f.project.id, f.project.dirs[0].id, 'fixture-profile', true).managed).toEqual([{ name: 'cross-agent' }]);
    expect((await f.submit('Use $cross-agent and mention $not-managed'))?.status).toBe('completed');
    const driver = f.instances[0];
    const [root] = driver.openOptions!.skillRoots!;
    expect(realpathSync(join(root.path, 'SKILL.md'))).toBe(realpathSync(file));
    expect(driver.input?.text).toContain(JSON.stringify(join(root.path, 'SKILL.md')));
    expect(driver.input?.text).toContain('\n\nUse $cross-agent and mention $not-managed');
  } finally { await f.close(); }
});

it.each([['claude', '2.1.329'], ['codex', '0.171.0'], ['codex', '0.999.0']] as const)(
  'provides %s %s the active project resources without an application bridge',
  async (kind, version) => {
    const f = fixture(kind, version);
    try {
      expect((await f.submit())?.status).toBe('completed');
      const options = f.instances[0].openOptions!;
      const runId = f.workspace.runs.runForTask(f.taskId)!.runId;
      const runRoot = join(f.root, 'capabilities', 'runs', f.project.id, f.taskId, runId);
      expect(options.env.PROJECT_DB_CONFIG).toBe(join(runRoot, 'databases.json'));
      expect(options.env.REMOTE_SERVERS_CONFIG).toBe(join(runRoot, 'servers.json'));
      const database = JSON.parse(readFileSync(options.env.PROJECT_DB_CONFIG, 'utf8')).projects[0].databases[0];
      const server = JSON.parse(readFileSync(options.env.REMOTE_SERVERS_CONFIG, 'utf8')).servers[0];
      expect(database.resourceId).toBe(f.database.id);
      expect(server.resourceId).toBe(f.server.id);
      expect(options.env[database.passwordEnv]).toBe('fixture-db-credential');
      expect(options.env[server.passwordEnv]).toBe('fixture-ssh-credential');
      expect(Object.values(options.env)).not.toContain('other-project-credential');
      expect(options.env.SMARTDD_DB_OLD_PASSWORD).toBeUndefined();
      await f.workspace.runs.close(runId);
      expect(existsSync(runRoot)).toBe(false);

      f.capabilities.setGlobalEnabled('smartdd-project-context', false);
      f.capabilities.setGlobalEnabled('project-db-diagnostics', false);
      const completed = await f.submit();
      expect(completed?.status, JSON.stringify(f.workspace.tasks.snapshot(f.taskId).items.filter(item => item.type === 'error'))).toBe('completed');
      const resumed = f.instances.at(-1)!.openOptions!;
      expect(resumed.resumeNativeId).toBe(f.instances[0].nativeId);
      expect(resumed.env.PROJECT_DB_CONFIG).toBeUndefined();
      expect(resumed.env.REMOTE_SERVERS_CONFIG).not.toBe(options.env.REMOTE_SERVERS_CONFIG);
      expect(existsSync(resumed.env.REMOTE_SERVERS_CONFIG)).toBe(true);
    } finally { await f.close(); }
  },
);

it('releases project resources when native launch fails before forking', async () => {
  const f = fixture('claude', '2.1.329');
  try {
    f.failBeforeFork();
    expect((await f.submit())?.status).toBe('failed');
    const env = f.instances[0].openOptions!.env;
    expect(env.PROJECT_DB_CONFIG).toMatch(/\/capabilities\/runs\//);
    expect(existsSync(dirname(env.PROJECT_DB_CONFIG))).toBe(false);
  } finally { await f.close(); }
});

it('keeps project shell credentials out of Antigravity while launching its authorized host bridge once', async () => {
  const f = fixture('antigravity', '1.5.14', true);
  const prepareAgent = vi.fn(async () => ({ mcpServers: { willYouHost: { command: '/bin/sh', args: [] } } }));
  f.workspace.attachBusiness({
    agentDelivery: () => 'verified', prepareAgent, attachAgentTools() {}, attachAgentRequests() {},
  } as unknown as Parameters<typeof f.workspace.attachBusiness>[0]);
  try {
    expect((await f.submit())?.status).toBe('completed');
    const options = f.instances[0].openOptions!;
    expect(options.env.GEMINI_API_KEY).toBe('fixture-gemini-key');
    expect(options.env).not.toHaveProperty('PROJECT_DB_CONFIG');
    expect(options.env).not.toHaveProperty('REMOTE_SERVERS_CONFIG');
    expect(options.env).not.toHaveProperty('SMARTDD_DB_OLD_PASSWORD');
    expect(options.projectContextMcp).toBeUndefined();
    expect(options.requiredMcpServers).toEqual(['willYouHost']);
    expect(options.extraArgs?.filter(arg => arg === 'acp')).toHaveLength(1);
    expect(prepareAgent).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it('M16 A19 does not dispatch a retained bound task after its actual source project was archived',async()=>{
  const f=fixture('codex','0.171.0');
  const schedules=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile:f.workspace.scheduleProfile,changed:()=>{}});
  try{
    schedules.start();
    const plan=await schedules.save({schedule:{type:'daily',time:'09:00',zone:'UTC'},config:{title:'Archived project fixture',prompt:'fixture',projectId:f.project.id,dirId:f.project.dirs[0].id,cwd:f.root,workspace:'directory',baseRef:null,destination:'existing',boundTask:f.taskId,profileId:'fixture-profile',tier:'ask',delegation:false,notifyCompleted:false},grace:60,enabled:false});
    f.projects.setArchived(f.project.id,true);
    expect(f.workspace.store.task(f.taskId)?.archived_at).toBeNull(); // project archive is distinct from task archive
    schedules.auditConfigurations();const repaired=schedules.store.plan(plan.id)!;
    expect(repaired.repair).toBeTruthy();expect(repaired.repair).toMatch(/项目.*失效/);expect(schedules.runNow(plan.id,repaired.revision,randomUUID()).kind).toBe('repair');
    expect(f.instances).toHaveLength(0);expect(f.workspace.store.turns(f.taskId)).toEqual([]);
  }finally{await schedules.stop();await f.close();}
});
it('M16 A19 revalidates the real project after async preparation and before creating any task',async()=>{
  const f=fixture('codex','0.171.0');const schedules=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile:f.workspace.scheduleProfile,changed:()=>{}});
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const prepare=vi.spyOn(schedules.workspaces,'prepare').mockImplementation(async()=>{await gate;return f.root;});
  try{
    schedules.start();const p=await schedules.save({schedule:{type:'daily',time:'09:00',zone:'UTC'},config:{title:'Project preparation race',prompt:'fixture',projectId:f.project.id,dirId:f.project.dirs[0].id,cwd:f.root,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'fixture-profile',tier:'ask',delegation:false,notifyCompleted:false},grace:60,enabled:false});
    const claim=schedules.runNow(p.id,p.revision,randomUUID());if(!('run'in claim))throw Error();
    await vi.waitFor(()=>expect(prepare).toHaveBeenCalledOnce());f.projects.setArchived(f.project.id,true);release();
    await vi.waitFor(()=>expect(schedules.store.run(claim.run.id)?.status).toBe('failed'));
    expect(schedules.store.plan(p.id)?.repair).toMatch(/项目.*失效/);
    expect(f.workspace.store.task(claim.run.taskId!)).toBeUndefined();expect(f.instances).toHaveLength(0);
  }finally{release();await schedules.stop();await f.close();}
});
it.each((['profile','model','directory'] as const).flatMap(kind=>(['existing','reuse'] as const).map(destination=>({kind,destination}))))('M16 A19 keeps a $destination bound task unsubmitted after $kind becomes unavailable',async ({kind,destination})=>{
  const f=fixture('codex','0.171.0');const isolated=join(f.root,'local-'+kind);mkdirSync(isolated);
  const task=destination==='existing'?f.workspace.tasks.create({projectId:null,dirId:null,cwd:isolated,title:'Actual bound fixture',profileId:'fixture-profile',tier:'ask',model:'fixture-model',effort:'medium'}):null;
  let available=true,models=['fixture-model'];const profile=()=>({available,compatibility:'fixed',kind:'codex',providerBacked:true,models,modelOptions:models.map(id=>({id,name:id,efforts:['medium']}))});
  const schedules=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile,changed:()=>{}});
  try{
    schedules.start();const p=await schedules.save({schedule:{type:'daily',time:'09:00',zone:'UTC'},config:{title:'Unavailable '+kind,prompt:'fixture',projectId:null,dirId:null,cwd:isolated,workspace:'directory',baseRef:null,destination,boundTask:task?.taskId??null,profileId:'fixture-profile',model:'fixture-model',effort:'medium',tier:'ask',delegation:false,notifyCompleted:false},grace:60,enabled:false});
    if(destination==='reuse'){
      const first=schedules.runNow(p.id,p.revision,randomUUID());if(!('run'in first))throw Error('initial reuse claim failed');
      await vi.waitFor(()=>expect(schedules.store.run(first.run.id)?.status).toBe('completed'));
      expect(schedules.store.plan(p.id)?.boundTask).toBe(first.run.taskId);
    }
    const taskId=schedules.store.plan(p.id)?.boundTask;expect(taskId).toBeTruthy();
    const originalTurns=f.workspace.store.turns(taskId!),originalInstances=f.instances.length,originalHistory=schedules.store.history(p.id);
    if(kind==='profile')available=false;
    if(kind==='model')models=[];
    if(kind==='directory')rmdirSync(isolated);
    schedules.auditConfigurations();const changed=schedules.store.plan(p.id)!;
    expect(changed.repair).toBeTruthy();expect(schedules.runNow(p.id,changed.revision,randomUUID()).kind).toBe('repair');
    expect(f.workspace.store.turns(taskId!)).toEqual(originalTurns);expect(f.instances).toHaveLength(originalInstances);
    expect(schedules.store.plan(p.id)?.boundTask).toBe(taskId);expect(schedules.store.history(p.id)).toEqual(originalHistory);
  }finally{await schedules.stop();await f.close();}
});
it('M16 A50 marks the emitted scheduled request origin only, keeping the ordinary request channel unchanged',async()=>{
  const f=fixture('codex','0.171.0');
  const schedules=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile:f.workspace.scheduleProfile,changed:()=>{}});
  try{
    schedules.start();
    const plan=await schedules.save({schedule:{type:'daily',time:'09:00',zone:'UTC'},config:{title:'Scheduled notice fixture',prompt:'M16-A50-REQUEST-FIXTURE',projectId:f.project.id,dirId:f.project.dirs[0].id,cwd:f.root,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'fixture-profile',tier:'ask',delegation:false,notifyCompleted:false},grace:60,enabled:false});
    const first=schedules.runNow(plan.id,plan.revision,randomUUID());if(!('run'in first))throw Error('schedule claim failed');
    await vi.waitFor(()=>expect(f.emitted.some(e=>e.taskId===first.run.taskId&&e.type==='request.opened')).toBe(true));
    const scheduled=f.emitted.filter(e=>e.taskId===first.run.taskId&&e.type==='request.opened');
    expect(scheduled).toHaveLength(1);expect(scheduled[0]).toMatchObject({scheduled:true});
    await f.submit('M16-A50-REQUEST-FIXTURE');
    const ordinary=f.emitted.filter(e=>e.taskId===f.taskId&&e.type==='request.opened');
    expect(ordinary).toHaveLength(1);expect(ordinary[0]).not.toHaveProperty('scheduled');
    expect(schedules.listNotices().filter(n=>n.taskId===f.taskId)).toHaveLength(0);
  }finally{await schedules.stop();await f.close();}
});
it('M16 A23 validates a native model and reasoning choice for a schedule with no project or task yet',async()=>{
  const f=fixture('codex','0.171.0');
  const catalog=vi.spyOn(f.workspace,'modelCatalog').mockResolvedValue({status:'ready',models:[{id:'native-model',name:'Native model',efforts:['medium','high']}]});
  const schedule=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile:()=>({available:true,compatibility:'fixture',kind:'codex',providerBacked:false,models:[]}),changed:()=>{}});
  try{
    const base={title:'Standalone native choice',prompt:'fixture',projectId:null,dirId:null,cwd:null,workspace:'directory' as const,baseRef:null,destination:'new' as const,boundTask:null,profileId:'fixture-profile',tier:'ask' as const,delegation:false,notifyCompleted:false};
    const choice=await schedule.save({schedule:{type:'daily',time:'09:00',zone:'UTC'},config:{...base,model:'native-model',effort:'medium'},grace:60,enabled:false});
    expect(choice.config).toMatchObject({projectId:null,dirId:null,model:'native-model',effort:'medium'});expect(catalog).toHaveBeenCalledWith({kind:'standalone'},'fixture-profile','wait');
    await expect(schedule.save({schedule:{type:'daily',time:'09:00',zone:'UTC'},config:{...base,model:'native-model',effort:'unsupported'},grace:60,enabled:false})).rejects.toThrow('推理档位');
    expect(f.instances).toHaveLength(0);
  }finally{await schedule.stop();await f.close();}
});
it('M16 A43 same physical cwd runs scheduled project and standalone through the real launch wiring without inheriting project resources',async()=>{
  const f=fixture('claude','2.1.329',true,true);
  const prepareAgent=vi.fn(async()=>({mcpServers:{willYouHost:{command:'/bin/sh',args:[]}}}));
  f.workspace.attachBusiness({agentDelivery:()=> 'verified',prepareAgent,attachAgentTools(){},attachAgentRequests(){}} as unknown as Parameters<typeof f.workspace.attachBusiness>[0]);
  const schedules=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile:f.workspace.scheduleProfile,changed:()=>{}});
  try{
    for(const [base,name] of [[f.home,'global-m16'],[f.root,'project-m16']]){
      const path=join(base,'.claude','skills',name,'SKILL.md');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,`---\nname: ${name}\ndescription: fixture skill\n---\nPUBLIC SYNTHETIC FIXTURE ${name}\n`);
    }
    mkdirSync(join(f.home,'.claude'),{recursive:true});
    writeFileSync(join(f.home,'.claude.json'),JSON.stringify({mcpServers:{globalM16:{command:'/usr/bin/true'}}}));
    writeFileSync(join(f.home,'.claude','.claude.json'),JSON.stringify({mcpServers:{globalM16:{command:'/usr/bin/true'}}}));
    writeFileSync(join(f.root,'.mcp.json'),JSON.stringify({mcpServers:{projectM16:{command:'/usr/bin/true'}}}));
    f.skills.scan();f.skills.adoptAll();
    schedules.start();
    for(const project of [true,false]){
      const plan=await schedules.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{title:project?'project fixture':'standalone fixture',prompt:'Use $global-m16 and $project-m16',projectId:project?f.project.id:null,dirId:project?f.project.dirs[0].id:null,cwd:f.root,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'fixture-profile',tier:'ask',delegation:false,notifyCompleted:false},grace:60,enabled:false});
      const claim=schedules.runNow(plan.id,plan.revision,randomUUID());if(!('run'in claim))throw Error();
      await vi.waitFor(()=>expect(schedules.store.run(claim.run.id)?.status).toBe('completed'),{timeout:4000});
      const source=schedules.store.run(claim.run.id)!;const driver=f.instances.at(-1)!,options=driver.openOptions!;
      expect(f.workspace.store.task(source.taskId!)?.project_id).toBe(project?f.project.id:null);
      expect(driver.input?.text).toContain('global-m16');expect(options.cwd).toBe(f.root);
      if(project){
        expect(options.settingSources).toEqual(['user','project','local']);
        expect(options.env.PROJECT_DB_CONFIG).toBeDefined();expect(options.env.REMOTE_SERVERS_CONFIG).toBeDefined();
        expect(options.projectContextMcp).toBeDefined();
        expect(JSON.stringify(options.claudeMcp)).toContain('projectM16');
      }else{
        expect(options.settingSources).toEqual(['user']);
        expect(options.env.PROJECT_DB_CONFIG).toBeUndefined();expect(options.env.REMOTE_SERVERS_CONFIG).toBeUndefined();
        expect(options.projectContextMcp).toBeUndefined();
        expect(Object.values(options.env)).not.toContain('fixture-db-credential');expect(Object.values(options.env)).not.toContain('other-project-credential');
        expect(JSON.stringify(options.claudeMcp)).toContain('globalM16');expect(JSON.stringify(options.claudeMcp)).not.toContain('projectM16');
        expect(JSON.stringify(prepareAgent.mock.calls.at(-1))).toContain('"applicationScope":"browser"');
      }
    }
  }finally{await schedules.stop();await f.close();}
});
it('M16 A43 forwards isolated native Codex project configuration and Skill paths only to the real standalone task scope',async()=>{
  const f=fixture('codex','0.169.0');
  const schedules=new ScheduleService({agent:f.workspace,home:f.home,userData:f.root,profile:f.workspace.scheduleProfile,changed:()=>{}});
  try{
    mkdirSync(join(f.root,'.git'));const skill=join(f.root,'.agents/skills/project-fixture/SKILL.md');mkdirSync(dirname(skill),{recursive:true});writeFileSync(skill,'---\nname: project-fixture\ndescription: public fixture\n---\n');
    schedules.start();
    for(const project of [true,false]){
      const plan=await schedules.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{title:project?'project scope':'standalone scope',prompt:'public fixture',projectId:project?f.project.id:null,dirId:project?f.project.dirs[0].id:null,cwd:f.root,workspace:'directory',baseRef:null,destination:'new',boundTask:null,profileId:'fixture-profile',tier:'ask',delegation:false,notifyCompleted:false},grace:60,enabled:false});
      const claim=schedules.runNow(plan.id,plan.revision,randomUUID());if(!('run'in claim))throw Error();await vi.waitFor(()=>expect(schedules.store.run(claim.run.id)?.status).toBe('completed'));
      const opts=f.instances.at(-1)!.openOptions!;
      expect(opts.cwd).toBe(f.root);
      if(project){expect(opts.nativeProjectSkillRoots).toBeUndefined();expect(opts.extraArgs?.some(a=>a.startsWith('projects='))).toBe(false);}
      else{expect(opts.nativeProjectSkillRoots).toContain(join(f.root,'.agents/skills'));expect(opts.extraArgs?.some(a=>a.startsWith('projects=')&&a.includes('trust_level="untrusted"'))).toBe(true);expect(opts.extraArgs?.some(a=>a.startsWith('skills.config=')&&a.includes('project-fixture/SKILL.md')&&a.includes('false'))).toBe(true);}
    }
  }finally{await schedules.stop();await f.close();}
});
it('keeps project context out of the required MCP set and preserves shell resources when its name is occupied', async () => {
  const f = fixture('codex', '0.171.0', true);
  try {
    expect((await f.submit())?.status).toBe('completed');
    const initial = f.instances[0].openOptions!;
    const context = initial.projectContextMcp!;
    expect(context.name).toMatch(/^smartdd_project_[a-f0-9]{12}$/);
    expect(initial.requiredMcpServers).toEqual([]);
    expect(context.args[1]).toBe(initial.env.SMARTDD_PROJECT_CONTEXT);
    await f.workspace.runs.close(f.workspace.runs.runForTask(f.taskId)!.runId);

    const config = join(f.home, '.codex', 'config.toml');
    mkdirSync(dirname(config));
    const contents = `[mcp_servers.${context.name}]\ncommand="user-owned"\n`;
    writeFileSync(config, contents);
    expect((await f.submit())?.status).toBe('completed');
    const resumed = f.instances.at(-1)!.openOptions!;
    expect(resumed.projectContextMcp).toBeUndefined();
    expect(existsSync(resumed.env.PROJECT_DB_CONFIG)).toBe(true);
    expect(existsSync(resumed.env.REMOTE_SERVERS_CONFIG)).toBe(true);
    expect(readFileSync(config, 'utf8')).toBe(contents);
    expect(f.workspace.tasks.snapshot(f.taskId).items).toContainEqual(expect.objectContaining({
      type: 'system_notice', payload: expect.objectContaining({ code: 'projectContextMcpUnavailable', detail: expect.stringContaining('已使用') }),
    }));
  } finally { await f.close(); }
});

it('reports a missing required project credential before the native process starts', async () => {
  const f = fixture('claude', '2.1.329');
  try {
    f.secrets.delete(secretKeys.databasePassword(f.database.id));
    expect((await f.submit())?.status).toBe('failed');
    expect(f.instances.every(instance => !instance.openOptions)).toBe(true);
    expect(f.workspace.tasks.snapshot(f.taskId).items).toContainEqual(expect.objectContaining({
      type: 'error', payload: expect.objectContaining({ message: expect.stringContaining('缺少凭据') }),
    }));
  } finally { await f.close(); }
});
