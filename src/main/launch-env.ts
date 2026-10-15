// How an AI profile's variables reach the CLI.
//
// The PTY runs `$SHELL -l -i -c ...` so PATH matches the user's terminal. That also runs ~/.zshrc,
// which may export ANTHROPIC_* globally and would silently override the profile. So values are
// handed over under a private prefix and exported again *after* the rc files, inside the -c
// script. Values never appear in argv (visible in `ps`); only variable names and prefixes do.

export const VALUE_PREFIX = '__SMARTDD_V_';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * -u PREFIX  unset every variable starting with PREFIX (whatever the rc files exported)
 * -e NAME    export NAME from __SMARTDD_V_NAME, then drop the carrier
 * --         the rest is the command; exec bypasses aliases and shell functions
 * Works in zsh and bash. Names are validated before they get here, so eval only sees identifiers.
 * `command` keeps aliases/functions from the (interactive) rc files out of the way.
 */
export const LAUNCH_SCRIPT = [
  'while [ "$#" -gt 0 ]; do',
  '  case "$1" in',
  `    -u) for __smartdd_n in $(command env | command sed -n "s/^\\($2[A-Za-z0-9_]*\\)=.*/\\1/p"); do unset "$__smartdd_n"; done; shift 2;;`,
  `    -e) eval "export $2=\\"\\\${${VALUE_PREFIX}$2}\\""; unset "${VALUE_PREFIX}$2"; shift 2;;`,
  '    --) shift; break;;',
  '    *) echo "smartdd: bad launch argument $1" >&2; exit 127;;',
  '  esac',
  'done',
  'unset __smartdd_n',
  'exec "$@"',
].join('\n');

export interface LaunchEnvPlan {
  /** Environment for the shell process. */
  env: Record<string, string>;
  /** Arguments that go between the -c script and the command. */
  scriptArgs: string[];
  /** Names the CLI will see, for the task header (no values). */
  injectedNames: string[];
}

/**
 * What a terminal app sets for the programs inside, as Yoda's pty-env does. Without COLORTERM
 * Claude Code falls back to 256 colours; an app started from Finder has no LANG, so the CLI
 * would not assume UTF-8.
 */
export function terminalIdentity(env: Record<string, string>): Record<string, string> {
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'smartdd',
    ...(env.LANG || env.LC_ALL || env.LC_CTYPE ? {} : { LANG: 'en_US.UTF-8' }),
  };
}

export function planLaunchEnv(
  base: Record<string, string>,
  injected: Record<string, string>,
  isolatePrefixes: string[]
): LaunchEnvPlan {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith(VALUE_PREFIX)) continue;
    if (isolatePrefixes.some((p) => k.startsWith(p))) continue;
    env[k] = v;
  }
  Object.assign(env, terminalIdentity(env));
  const scriptArgs: string[] = [];
  for (const p of isolatePrefixes) {
    if (!NAME_RE.test(p)) throw new Error(`无效的变量前缀：${p}`);
    scriptArgs.push('-u', p);
  }
  const names = Object.keys(injected).sort();
  for (const name of names) {
    if (!NAME_RE.test(name)) throw new Error(`无效的变量名：${name}`);
    env[VALUE_PREFIX + name] = injected[name];
    scriptArgs.push('-e', name);
  }
  scriptArgs.push('--');
  return { env, scriptArgs, injectedNames: names };
}

/** Variables left by a parent Claude Code (e.g. when SmartDD is started from one) that change CLI behaviour. */
export const PARENT_AGENT_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'];
