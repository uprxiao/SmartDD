export const GOAL_CLI_MIN_VERSION = { codex: '0.169.0', claude: '2.1.326', antigravity: '1.5.14' } as const;
export type GoalInput = { kind: 'set'; objective: string } | { kind: 'clear' };

export function canConfigureGoal(kind: string, version?: string | null): boolean {
  if (!Object.hasOwn(GOAL_CLI_MIN_VERSION, kind)) return false;
  const detected = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(version ?? '');
  if (!detected) return false;
  const required = GOAL_CLI_MIN_VERSION[kind as keyof typeof GOAL_CLI_MIN_VERSION].split('.').map(Number);
  const actual = detected.slice(1).map(Number);
  for (const [index, part] of required.entries()) {
    if (actual[index] !== part) return actual[index] > part;
  }
  return true;
}

export function composerGoal(text: string, goalMode: boolean): GoalInput | null {
  const command = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!goalMode && !command) return null;
  if (command?.[1]?.trim() === 'clear') return { kind: 'clear' };
  return { kind: 'set', objective: (command ? command[1] ?? '' : text).trim() };
}
