import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type AiProfileInput } from '@shared/ai-profiles';
import { createRPCController } from '@shared/ipc/rpc';
import type { Runner } from '@shared/types';
import { PARENT_AGENT_VARS } from '../../launch-env';
import type { AiProfileService } from './ai-profile-service';
import type { ProfileHealth } from './profile-health';

const defaultZshrc = () => join(homedir(), '.zshrc');

// The file is read here in main and never sent to the renderer: only the masked preview leaves.
async function readRc(path?: string | null): Promise<string> {
  const file = path?.trim() || defaultZshrc();
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    throw new Error(`读取 ${file} 失败：${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
}

export function createAiProfileController(svc: AiProfileService, health: ProfileHealth, baseEnv: () => Record<string, string>) {
  const detectEnv = () => {
    const env = { ...baseEnv() };
    for (const k of PARENT_AGENT_VARS) delete env[k];
    return env;
  };
  return {
    aiProfiles: createRPCController({
      list: () => svc.list().map((v) => health.withChecking(v)),
      get: (id: string) => health.withChecking(svc.get(id)),
      // Auto tests run after import / create / an edit that changes how the CLI starts — never at startup.
      create: (input: AiProfileInput) => {
        const view = svc.create(input);
        health.testInBackground(view.id, 'auto');
        return health.withChecking(view);
      },
      update: (id: string, input: AiProfileInput) => {
        const before = svc.launchSignature(id);
        const view = svc.update(id, input);
        if (svc.launchSignature(id) !== before) health.testInBackground(id, 'auto');
        return health.withChecking(view);
      },
      test: (id: string) => health.test(id, 'manual'),
      delete: (id: string) => svc.delete(id),
      setDefault: (id: string) => svc.setDefault(id),
      defaultZshrcPath: () => defaultZshrc(),
      previewZshrc: async (path?: string | null) => svc.previewZshrc(await readRc(path)),
      importZshrc: async (path: string | null, accounts: string[]) => {
        const r = svc.importZshrc(await readRc(path), accounts);
        for (const v of r.created) health.testInBackground(v.id, 'auto');
        return { ...r, created: r.created.map((v) => health.withChecking(v)) };
      },
      detectRunners: () => Promise.all(svc.runnerAdapters.list().map(async adapter => ({ runner: adapter.id, ...await adapter.discoverExecutable(null, { env: detectEnv() }) }))),
      detectRunner: async (runner: Runner, executable: string | null) => ({ runner, ...await svc.runnerAdapters.get(runner).discoverExecutable(executable, { env: detectEnv() }) }),
    }),
  };
}
