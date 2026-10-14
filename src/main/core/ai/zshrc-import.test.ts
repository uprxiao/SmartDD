import { describe, expect, it } from 'vitest';
import { maskPreview, parseZshrc } from './zshrc-import';

// Fictional sample shaped like a real account switcher; no real values.
const SAMPLE = `
export PATH="$HOME/bin:$PATH"
export ANTHROPIC_BASE_URL=https://global.invalid

claude_with_account() {
  local account=$1
  shift
  unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_MODEL
  case $account in
    "work"|"w")
      export ANTHROPIC_BASE_URL="https://work.invalid/api"
      export ANTHROPIC_AUTH_TOKEN="sk-work-0123456789abcdef"
      #export ANTHROPIC_MODEL="old-model"
      echo "using work"
      ;;
    "deepseek")
      export ANTHROPIC_BASE_URL='https://ds.invalid/anthropic'
      export ANTHROPIC_AUTH_TOKEN='ds-token-value'
      export ANTHROPIC_MODEL=deepseek-chat   # trailing comment
      export API_TIMEOUT_MS="600000"; export ANTHROPIC_SMALL_FAST_MODEL="ds-small"
      ;;
    glm) export ANTHROPIC_BASE_URL="https://glm.invalid"; export ANTHROPIC_AUTH_TOKEN="$GLM_KEY" ;;
    *)
      echo "unknown account: $account"
      return 1
      ;;
  esac
  ce "$@"
}

alias cw='claude_with_account work'
alias cww="claude_with_account w --verbose"
alias cdsh='claude_with_account deepseek'
alias other='ls -la'
`;

describe('parseZshrc', () => {
  const r = parseZshrc(SAMPLE);

  it('finds every account branch, skipping the catch-all', () => {
    expect(r.found).toBe(true);
    expect(r.accounts.map((a) => a.account)).toEqual(['work', 'deepseek', 'glm']);
    expect(r.accounts[0].labels).toEqual(['work', 'w']);
  });

  it('reads literal exports, ignoring commented lines and echo', () => {
    const work = r.accounts[0];
    expect(work.env).toEqual([
      { name: 'ANTHROPIC_BASE_URL', secret: false, value: 'https://work.invalid/api' },
      { name: 'ANTHROPIC_AUTH_TOKEN', secret: true, value: 'sk-work-0123456789abcdef' },
    ]);
    expect(work.warnings).toEqual([]);
  });

  it('handles single quotes, bare words, trailing comments and several exports on one line', () => {
    const ds = r.accounts[1];
    expect(Object.fromEntries(ds.env.map((e) => [e.name, e.value]))).toEqual({
      ANTHROPIC_BASE_URL: 'https://ds.invalid/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'ds-token-value',
      ANTHROPIC_MODEL: 'deepseek-chat',
      API_TIMEOUT_MS: '600000',
      ANTHROPIC_SMALL_FAST_MODEL: 'ds-small',
    });
  });

  it('does not take over values that need the shell, and says so', () => {
    const glm = r.accounts[2];
    expect(glm.env.find((e) => e.name === 'ANTHROPIC_AUTH_TOKEN')).toEqual({
      name: 'ANTHROPIC_AUTH_TOKEN',
      secret: true,
      value: '',
    });
    expect(glm.warnings[0]).toContain('ANTHROPIC_AUTH_TOKEN 的值引用了其他变量');
  });

  it('maps aliases to accounts by any label', () => {
    expect(r.accounts[0].aliases).toEqual(['cw', 'cww']);
    expect(r.accounts[1].aliases).toEqual(['cdsh']);
    expect(r.accounts[2].aliases).toEqual([]);
  });

  it('warns about the command run after esac', () => {
    expect(r.warnings).toEqual([expect.stringContaining('「ce」')]);
  });

  it('reports a missing function', () => {
    expect(parseZshrc('alias ll="ls -l"\n')).toEqual({ found: false, accounts: [], warnings: [] });
  });

  it('accepts the `function name {` form', () => {
    const r2 = parseZshrc('function claude_with_account {\n case "$1" in\n a) export X_TOKEN=abc;;\n esac\n}\n');
    expect(r2.accounts).toEqual([
      { account: 'a', labels: ['a'], aliases: [], env: [{ name: 'X_TOKEN', secret: true, value: 'abc' }], warnings: [] },
    ]);
  });
});

describe('maskPreview', () => {
  it('never reveals any part of a secret', () => {
    const p = maskPreview('ANTHROPIC_AUTH_TOKEN', 'sk-work-0123456789abcdef', true);
    expect(p).toBe('••••••（24 位）');
    expect(p).not.toContain('sk-');
  });

  it('shows plain values but still redacts credentials embedded in them', () => {
    expect(maskPreview('ANTHROPIC_BASE_URL', 'https://work.invalid/api', false)).toBe('https://work.invalid/api');
    expect(maskPreview('URL', 'https://u:pw@h.invalid', false)).toBe('https://u:***@h.invalid');
    expect(maskPreview('X', 'github_pat_ABCdef123', false)).toBe('***');
    expect(maskPreview('X', '', false)).toBe('（空）');
  });
});
