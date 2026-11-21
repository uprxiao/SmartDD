import { isAbsolute, resolve } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { nativeLaunchFieldSchemas, type NativeInventory, type NativeUserSkillConfig } from '@shared/agent-adapters';
import { discoverCapabilities, type DiscoveryContext, type NativeDiscoveryDetails } from '../capabilities/discovery';
import type { TaskCapabilityLauncher } from '../tasks/capability-lifecycle';
import { detectNativeCli, nativeExecutableIdentity, type CheckedNativeCli } from '../ai/runner-detect';
export type TaskLaunchInput = Parameters<TaskCapabilityLauncher['prepare']>[0];
export interface NativeLaunchContext { command: string; version: string; inventory: NativeInventory; userSkillConfig: NativeUserSkillConfig;shellPath?: string;shellProxy?: Record<string,string>;skillConfigSources?:NativeDiscoveryDetails['skillConfigSources'] }
/** Read only native files and execute exactly --version in the login shell, never profile arguments, login helpers or a model. */
export async function inspectNativeLaunch(input: TaskLaunchInput, checked?: CheckedNativeCli): Promise<NativeLaunchContext> {
  const env = input.environment, requested = input.profile.command;
  // Same login shell as the PTY launch: a Finder-launched app has a bare PATH, so `#!/usr/bin/env node` CLIs fail outside it.
  const detected = checked && checked.runner === input.profile.runner && checked.path === requested
    && checked.identity === nativeExecutableIdentity(requested) ? checked
    : await detectNativeCli(input.profile.runner, !isAbsolute(requested) && requested.includes('/') ? resolve(input.cwd,requested) : requested, {env,signal:input.signal});
  if (input.signal.aborted) throw new ApplicationError('CANCELED','任务能力准备已取消');
  if (!detected.path || !detected.shellPath) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','无法核验当前CLI命令；保留原生Agent入口');
  const command = detected.path, match = /^(?:claude(?: code)?\s+|codex(?:-cli)?\s+)?(\d+\.\d+\.\d+)(?:\s|$)/i.exec(detected.version ?? '');
  if (!match) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','当前CLI版本未能核验；原生Agent配置保持原样');
  const version = match[1];
  const details: NativeDiscoveryDetails = {userSkillConfig:[],plugins:[],issues:[]};
  const context: DiscoveryContext = {runner:input.profile.runner,cwd:input.cwd,home:input.home,stateRoot:input.stateRoot,claudeConfigExplicit:input.claudeConfigExplicit,path:detected.shellPath,args:input.profile.args,details,nativeVersion:version};
  const found = discoverCapabilities(context);
  const userSkillConfig=details.effectiveSkillConfig??details.userSkillConfig;
  if (details.issues.length || found.length >= 2000 || !nativeLaunchFieldSchemas.userSkillConfig.safeParse(userSkillConfig).success) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','原生能力配置尚未完整核验；本次不覆盖用户能力配置');
  return {command,version,shellPath:detected.shellPath,shellProxy:detected.shellProxy,userSkillConfig,skillConfigSources:details.skillConfigSources??[],inventory:[...found.map(row=>({kind:row.kind,name:row.name,path:row.path,ownerStoreId:null,contentHash:null})),...details.plugins.map(p=>({kind:'plugin' as const,...p,ownerStoreId:null,contentHash:null}))]};
}
