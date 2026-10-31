import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { agentLoadRequestSchema, type AgentLoadRequest } from '@shared/agent-adapters';
import { discoverCapabilities, type DiscoveryContext, type NativeDiscoveryDetails } from '../capabilities/discovery';
import type { TaskCapabilityLauncher } from '../tasks/capability-lifecycle';
export type TaskLaunchInput = Parameters<TaskCapabilityLauncher['prepare']>[0];
export interface NativeLaunchContext { command: string; version: string; inventory: AgentLoadRequest['inventory']; userSkillConfig: AgentLoadRequest['userSkillConfig'] }
/** Read only native files and execute exactly --version, never profile arguments, login helpers or a model. */
export async function inspectNativeLaunch(input: TaskLaunchInput): Promise<NativeLaunchContext> {
  const env = input.environment, requested = input.profile.command;
  const candidates = isAbsolute(requested) ? [requested] : requested.includes('/') ? [resolve(input.cwd,requested)] : (env.PATH ?? '').split(delimiter).filter(Boolean).map(p => resolve(input.cwd,p,requested));
  const command = candidates.find(p => { try { accessSync(p,constants.X_OK); return statSync(p).isFile(); } catch { return false; } });
  if (!command) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','无法核验当前CLI命令；保留原生Agent入口');
  const version = await new Promise<string>((done,reject) => {
    execFile(command,['--version'],{cwd:input.cwd,env,signal:input.signal,timeout:5000,maxBuffer:8192,encoding:'utf8',windowsHide:true},(error,stdout) => {
      const match = /^(?:claude(?: code)?\s+|codex(?:-cli)?\s+)?(\d+\.\d+\.\d+)(?:\s|$)/i.exec(stdout.trim());
      if (error || !match) reject(new ApplicationError(input.signal.aborted?'CANCELED':'AGENT_ADAPTER_UNSUPPORTED','当前CLI版本未能核验；原生Agent配置保持原样'));
      else done(match[1]);
    });
  });
  const details: NativeDiscoveryDetails = {userSkillConfig:[],plugins:[],issues:[]};
  const context: DiscoveryContext = {runner:input.profile.runner,cwd:input.cwd,home:input.home,stateRoot:input.stateRoot,claudeConfigExplicit:input.claudeConfigExplicit,path:env.PATH ?? '',args:input.profile.args,details,nativeVersion:version};
  const found = discoverCapabilities(context);
  if (details.issues.length || found.length >= 2000 || !agentLoadRequestSchema.shape.userSkillConfig.safeParse(details.userSkillConfig).success) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','原生能力配置尚未完整核验；本次不覆盖用户能力配置');
  return {command,version,userSkillConfig:details.userSkillConfig,inventory:[...found.map(row=>({kind:row.kind,name:row.name,path:row.path,ownerStoreId:null,contentHash:null})),...details.plugins.map(p=>({kind:'plugin' as const,...p,ownerStoreId:null,contentHash:null}))]};
}
