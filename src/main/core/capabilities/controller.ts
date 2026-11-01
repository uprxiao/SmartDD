import { createRPCController } from '@shared/ipc/rpc';
import type { AiProfileService } from '../ai/ai-profile-service';
import type { CapabilityService } from './capability-service';

export function createCapabilityController(svc: CapabilityService, profiles: AiProfileService, baseEnv: () => Record<string, string>) {
  return { capabilities: createRPCController({
    list: (projectId?: string) => svc.list(projectId),
    projectSettings: (projectId: string) => ({ skills: svc.list(projectId), mcpEnabled: svc.enabled(projectId, 'smartdd-project-context') }),
    setEnabled: (projectId: string, capabilityId: string, enabled: boolean) => svc.setEnabled(projectId, capabilityId, enabled),
    upgrade: (skillId: string) => svc.upgrade(skillId),
    preview: (opts: { projectId?: string; aiProfileId: string; cwd?: string }) => {
      // Discovery needs the non-secret paths only. Do not decrypt profile credentials to scan files.
      const p = profiles.get(opts.aiProfileId);
      const description = profiles.runnerAdapters.get(p.runner).describe();
      const env = Object.fromEntries(p.env.filter((e) => !e.secret && e.value !== null).map((e) => [e.name, e.value!]));
      return svc.preview(opts.projectId, { id: p.id, name: p.name, runner: p.runner, command: p.executable ?? description.command, args: p.args, env, isolatePrefixes: [...(description.isolatedEnvPrefixes??[])] }, baseEnv(), opts.cwd);
    },
  }) };
}
