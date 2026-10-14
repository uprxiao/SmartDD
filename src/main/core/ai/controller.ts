import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { RUNNER_IDS, type AiProfileInput } from '@shared/ai-profiles';
import { createRPCController } from '@shared/ipc/rpc';
import type { Runner } from '@shared/types';
import { PARENT_AGENT_VARS } from '../../launch-env';
import type { AiProfileService } from './ai-profile-service';
import { detectRunner } from './runner-detect';

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

export function createAiProfileController(svc: AiProfileService, baseEnv: () => Record<string, string>) {
  const detectEnv = () => {
    const env = { ...baseEnv() };
    for (const k of PARENT_AGENT_VARS) delete env[k];
    return env;
  };
  return {
    aiProfiles: createRPCController({
      list: () => svc.list(),
      get: (id: string) => svc.get(id),
      create: (input: AiProfileInput) => svc.create(input),
      update: (id: string, input: AiProfileInput) => svc.update(id, input),
      delete: (id: string) => svc.delete(id),
      setDefault: (id: string) => svc.setDefault(id),
      defaultZshrcPath: () => defaultZshrc(),
      previewZshrc: async (path?: string | null) => svc.previewZshrc(await readRc(path)),
      importZshrc: async (path: string | null, accounts: string[]) => svc.importZshrc(await readRc(path), accounts),
      detectRunners: () => Promise.all(RUNNER_IDS.map((r) => detectRunner(r, null, { env: detectEnv() }))),
      detectRunner: (runner: Runner, executable: string | null) => detectRunner(runner, executable, { env: detectEnv() }),
    }),
  };
}
