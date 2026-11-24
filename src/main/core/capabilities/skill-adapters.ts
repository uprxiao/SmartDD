import { join } from 'node:path';
import type { Runner } from '@shared/types';
import { managedClaudeRoot, managedCodexRoot } from '../ai/agent-launch-plan';

interface SkillPaths {
  home: string;
  stateRoot: string;
}

interface SkillLaunchPaths extends SkillPaths {
  runRoot: string;
  nativeLogin: boolean;
}

type SkillPlacement =
  | { kind: 'directory'; root: string; projectRoot?: string; checkNativeRoots?: boolean }
  | { kind: 'claude-plugin' | 'private-directory'; root: string };

interface DraftContext {
  home: string;
  env: Record<string, string>;
  userData: string;
  profileId: string;
  nativeLogin: boolean;
  carryExtensions: boolean;
}

interface SkillAdapter {
  runner: Runner;
  label: string;
  stateRoot(home: string, env: Record<string, string>): string;
  userRoots(paths: SkillPaths): string[];
  projectRoots(project: string): string[];
  placement(paths: SkillLaunchPaths, projectRoot: string | null): SkillPlacement;
  draftCatalog?(context: DraftContext): SkillPaths & { scope: 'all' | 'user' | 'project'; claudeConfigExplicit?: boolean };
  isolatedHome?: boolean;
}

export const skillAdapters: readonly SkillAdapter[] = [
  {
    runner: 'claude',
    label: 'Claude Code',
    stateRoot: (home, env) => env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
    userRoots: ({ stateRoot }) => [join(stateRoot, 'skills')],
    projectRoots: project => [join(project, '.claude/skills')],
    placement: (paths, project) => paths.nativeLogin || project
      ? { kind: 'claude-plugin', root: join(paths.runRoot, 'willyou-run/skills') }
      : { kind: 'directory', root: join(paths.stateRoot, 'skills') },
    draftCatalog: ({ home, env, userData, profileId, nativeLogin, carryExtensions }) => ({
      home,
      stateRoot: nativeLogin ? env.CLAUDE_CONFIG_DIR ?? join(home, '.claude') : managedClaudeRoot(userData, profileId),
      scope: nativeLogin ? carryExtensions ? 'all' : 'project' : 'user',
      claudeConfigExplicit: !nativeLogin || Boolean(env.CLAUDE_CONFIG_DIR),
    }),
  },
  {
    runner: 'codex',
    label: 'Codex',
    stateRoot: (home, env) => env.CODEX_HOME || join(home, '.codex'),
    userRoots: ({ home, stateRoot }) => [join(home, '.agents/skills'), join(stateRoot, 'skills'), '/etc/codex/skills'],
    projectRoots: project => [join(project, '.agents/skills')],
    placement: ({ home }, project) => ({
      kind: 'directory', root: join(project ?? home, '.agents/skills'), projectRoot: project ?? undefined, checkNativeRoots: true,
    }),
    draftCatalog: ({ home, env, userData, profileId, nativeLogin }) => {
      const stateRoot = nativeLogin ? env.CODEX_HOME ?? join(home, '.codex') : managedCodexRoot(userData, profileId);
      return { home: nativeLogin ? home : join(stateRoot, 'home'), stateRoot, scope: 'all' };
    },
  },
  {
    runner: 'antigravity',
    label: 'Antigravity',
    stateRoot: home => join(home, '.gemini'),
    userRoots: ({ stateRoot }) => ['antigravity-cli/skills', 'skills', 'config/skills'].map(path => join(stateRoot, path)),
    projectRoots: project => ['.agents', '.agent', '_agents', '_agent'].map(path => join(project, path, 'skills')),
    placement: ({ runRoot }) => ({ kind: 'private-directory', root: join(runRoot, 'agy-gemini/skills') }),
    isolatedHome: true,
  },
];

export function skillAdapter(runner: Runner): SkillAdapter | undefined {
  return skillAdapters.find(adapter => adapter.runner === runner);
}
