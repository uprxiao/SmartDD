import { RUNNERS, type AiProfileInput, type AiProfileView, type RunnerInfo } from './ai-profiles';

/** Detection locates a CLI; it must never rewrite a user's saved settings. */
export function profileForRunner(profiles: AiProfileView[], runner: RunnerInfo['runner']): AiProfileView | undefined {
  return profiles.find((p) => p.runner === runner && p.isDefault) ?? profiles.find((p) => p.runner === runner);
}

export function inputForDetectedRunner(info: RunnerInfo, profiles: AiProfileView[]): AiProfileInput {
  if (!info.path) throw new Error('CLI executable was not found');
  const base = RUNNERS[info.runner].label;
  const names = new Set(profiles.map((p) => p.name.toLowerCase()));
  let name = base;
  for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`;
  // Native CLI login/config is intentionally reused. Credentials never cross this boundary.
  return { name, runner: info.runner, executable: info.path, args: [], env: [], color: null, isDefault: false };
}
