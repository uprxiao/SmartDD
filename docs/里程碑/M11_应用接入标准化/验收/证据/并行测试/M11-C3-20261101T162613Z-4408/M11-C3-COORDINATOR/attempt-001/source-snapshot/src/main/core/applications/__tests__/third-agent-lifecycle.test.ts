import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { expect, it, vi } from 'vitest';
import { aiProfileInputSchema } from '@shared/ai-profiles';
import * as schema from '../../../db/schema';
import { runBundledMigrations } from '../../../db/migrations';
import { SecretsStore } from '../../../secrets';
import { PtyManager } from '../../../pty-manager';
import { ProjectService } from '../../projects/project-service';
import { AiProfileService } from '../../ai/ai-profile-service';
import { TaskService } from '../../tasks/task-service';
import { builtinRunnerAdapters, RunnerAdapterRegistry, type RunnerAdapter } from '../../tasks/runner-adapters';
import { CapabilityService, MCP_CAPABILITY } from '../../capabilities/capability-service';
import { ResourceStore } from '../resource-store';
import { AgentSupportService } from '../agent-support-service';
import { AgentAdapterRegistry } from '../agent-adapter-registry';
import { builtinCapabilityDeliveryAdapters, CapabilityDeliveryAdapterRegistry } from '../capability-delivery-adapters';
import { ApplicationService } from '../application-service';
import { ManagedTaskCapabilities } from '../task-capability-launcher';
import { MacProcessIdentityReader } from '../process-identity';

it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('T35 registered third Agent creates/resumes a real native session and reads its Skill before calling the actual MCP child', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-third-agent-'))), home = join(root,'home'), cwd = join(root,'project'), nativeRoot = join(home,'.scripted');
  mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(nativeRoot);
  const sqlite = new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
  const db = drizzle(sqlite,{schema}), secrets = new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});
  const projects = new ProjectService(db,secrets), projectId = projects.createProject({name:'T35 isolated project',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
  const quote = (s:string) => "'" + s.replaceAll("'","'\\''") + "'", command = join(root,'scripted-agent');
  writeFileSync(command,'#!/bin/sh\nexec '+quote(process.execPath)+' '+quote(resolve('src/main/core/applications/__tests__/fixtures/scripted-agent.mjs'))+' "$@"\n',{mode:0o700});
  const runner:RunnerAdapter = {
    id:'scripted-test',describe:()=>({id:'scripted-test',agentId:'scripted-test',label:'Scripted Test',sessionLabel:'Scripted Test',command}),
    profileSchema:()=>aiProfileInputSchema.refine(profile=>profile.runner==='scripted-test'),
    discoverExecutable:async()=>({command,path:command,version:'1.0.0',error:null}),detectVersion:async()=> '1.0.0',
    stateEnvVar:'SCRIPTED_STATE_ROOT',preserveImplicitStateRoot:false,defaultStateRoot:home=>join(home,'.scripted'),
    stateRoot:(profile,base)=>profile.SCRIPTED_STATE_ROOT||base.SCRIPTED_STATE_ROOT||join(profile.HOME||base.HOME!,'.scripted'),
    launchArgs:input=>['--mode',input.mode,'--session-id',input.sessionId!,...(input.profileArgs??[]),...(input.runtimeArgs??[]),'--initial',input.firstMessage??''],
    sessionIdStrategy:'host',observeSessions:async()=>[],sessionFile:(root,_cwd,id)=>existsSync(join(root,id+'.jsonl'))?join(root,id+'.jsonl'):null,canConfirmNoHistory:root=>existsSync(root),
  };
  const runners = new RunnerAdapterRegistry([...builtinRunnerAdapters.list(),runner]);
  const delivery = new CapabilityDeliveryAdapterRegistry([...builtinCapabilityDeliveryAdapters.list(),{
    id:'scripted-test',runnerId:'scripted-test',discovery:'shared-home',skillProjection:context=>join(context.home,'.agents/skills'),entryDelivery:entry=>entry==='mcp',
    inspectNative:async input=>({command:input.profile.command,version:(await runner.detectVersion(input.profile.command,{env:input.environment}))!,inventory:[],userSkillConfig:[]}),
  }]);
  const profiles = new AiProfileService(db,secrets,Date.now,runners), report=join(root,'report.json'), stop=join(root,'stop');
  const profile = profiles.create({name:'Scripted Test',runner:'scripted-test',executable:command,env:[{name:'ELECTRON_RUN_AS_NODE',secret:false,value:'1'},{name:'WY_SCRIPTED_REPORT',secret:false,value:report},{name:'WY_SCRIPTED_STOP',secret:false,value:stop}],args:[],color:null,isDefault:true});
  const capabilities = new CapabilityService({db,projects,secrets,userData:root}), store = new ResourceStore(sqlite,root);
  const metadata = {schema:'willyou-agent-adapter-v1' as const,agentId:'scripted-test',version:'1.0.0',entry:'index.cjs' as const,projectionFormatVersion:1 as const,platforms:['darwin-arm64' as const],cliVersions:['1.0.0'],bridgeRecovery:'unverified' as const,evidenceBaseline:'T35 scripted CLI only; L0/L1',levels:{'1.0.0':['L0.skill' as const,'L0.mcp' as const,'L1' as const]}};
  const planner = `exports.api=1;exports.agentId='scripted-test';exports.version='1.0.0';exports.prepare=input=>({schema:1,agentId:'scripted-test',phase:'prepared',bridgeRecovery:'unverified',args:['--capability-config',input.mcpConfigPath],files:{'mcp.json':JSON.stringify({servers:input.mcp,skills:[...input.snapshot.packages.flatMap(p=>p.skills.map(s=>s.projectionPath)),...input.snapshot.standardSkills.map(s=>s.projectionPath)]})}});`;
  const support = new AgentSupportService(store,capabilities,resolve('out/capability-bundles-compatibility-v1'),{adapters:new AgentAdapterRegistry(store,undefined,delivery),additionalAdapters:[{metadata,files:{'index.cjs':Buffer.from(planner)}}]});
  const ptys = new PtyManager(), helper=resolve('out/native/willyou-process-identity'), processes=new MacProcessIdentityReader(helper);
  const tasks = new TaskService({db,ptys,profiles,projects,capabilities,runnerAdapters:runners,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',SHELL:'/bin/sh'}),onChanged:()=>{}});
  let applications:ApplicationService|undefined, managed:ManagedTaskCapabilities|undefined; const oldShell=process.env.SHELL;process.env.SHELL='/bin/sh';let transcript='';ptys.on('data',(_id,data)=>{transcript+=data;});
  try {
    await support.initialize();expect(support.status().state).toBe('ready');
    for(const skill of capabilities.list(projectId))capabilities.setEnabled(projectId,skill.id,false);capabilities.setEnabled(projectId,MCP_CAPABILITY,false);
    applications=new ApplicationService(store,{secrets,projects,tasks,activePty:id=>tasks.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes});await applications.recover();
    managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper,processes,stopPty:id=>ptys.kill(id),pollMs:20});tasks.attachManagedCapabilities(managed);
    await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
    const first=await tasks.create({projectId,dirId:null,aiProfileId:profile.id,firstMessage:'synthetic third Agent task'}), firstRun=first.task.runtimeSnapshot!.runId;
    const observed=await vi.waitFor(()=>{try{return JSON.parse(readFileSync(report,'utf8'));}catch{throw Error('scripted report pending: '+transcript.slice(-2000));}},{timeout:15000});
    expect(observed).toMatchObject({agentId:'scripted-test',mode:'new',sessionId:first.task.nativeSessionId});expect(observed.result.isError).not.toBe(true);expect(observed.result.structuredContent).toEqual({items:[],nextCursor:null});
    expect(observed.skills.length).toBeGreaterThan(0);expect(observed.skills[0].content).toContain('smartdd_mail_draft_list_v1');
    const fixed=(await managed.sessions.get(first.task.id)).snapshot;expect(fixed.runner).toBe('scripted-test');expect(fixed.adapterBinding.id).toBe('scripted-test');expect(managed.runs.assertActive(firstRun).snapshot.runner).toBe('scripted-test');
    const diagnostic=await applications.sessionDiagnostics.inspect(first.task.id,firstRun);expect(diagnostic.selection).toBe('fixed');expect(diagnostic.applications.find(a=>a.appId==='mail')?.resourceState).toBe('verified');expect(diagnostic.currentRun?.runPlan?.levels.filter(l=>l.state!=='unverified').map(l=>l.level)).toEqual(['L0.skill','L0.mcp','L1']);expect(diagnostic.currentRun?.runPlan?.nativeSendEvidence).toBe(false);
    writeFileSync(stop,'stop');await vi.waitFor(()=>expect(tasks.activePty(first.task.id)).toBeNull(),{timeout:10000});await vi.waitFor(()=>expect(managed!.runs.get(firstRun).state).toBe('stopped'),{timeout:10000});
    rmSync(stop);rmSync(report);const reopened=await tasks.open({taskId:first.task.id,aiProfileId:profile.id});expect(reopened.task.nativeSessionId).toBe(first.task.nativeSessionId);
    const resumed=await vi.waitFor(()=>JSON.parse(readFileSync(report,'utf8')),{timeout:15000});expect(resumed).toMatchObject({agentId:'scripted-test',mode:'resume',sessionId:first.task.nativeSessionId});expect(resumed.result.isError).not.toBe(true);expect((await managed.sessions.get(first.task.id)).snapshot.adapterBinding).toEqual(fixed.adapterBinding);
    expect(readFileSync(join(nativeRoot,first.task.nativeSessionId!+'.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line).mode)).toEqual(['new','resume']);
    const lastRun=reopened.task.runtimeSnapshot!.runId;writeFileSync(stop,'stop');await vi.waitFor(()=>expect(managed!.runs.get(lastRun).state).toBe('stopped'),{timeout:10000});
  } finally {
    writeFileSync(stop,'stop');tasks.dispose();await managed?.dispose();await applications?.dispose();capabilities.dispose();sqlite.close();rmSync(root,{recursive:true,force:true});if(oldShell===undefined)delete process.env.SHELL;else process.env.SHELL=oldShell;
  }
},60000);
