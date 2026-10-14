// Reads the account switcher users already have in ~/.zshrc (PRD F04 step 3):
//
//   claude_with_account() {
//     local account=$1; shift
//     case $account in
//       "work"|"w") export ANTHROPIC_BASE_URL="https://..."; export ANTHROPIC_AUTH_TOKEN="sk-..." ;;
//       ...
//     esac
//     claude "$@"
//   }
//   alias cw='claude_with_account work'
//
// The file is parsed, never executed. Values stay in the main process: the renderer only gets
// a masked preview, and import re-reads the file.

import { isSecretEnvName } from '@shared/ai-profiles';
import { redact } from '../connections/redact';

export const ZSHRC_FUNCTION = 'claude_with_account';

export interface ParsedAccount {
  account: string;
  labels: string[];
  aliases: string[];
  env: { name: string; secret: boolean; value: string }[];
  warnings: string[];
}

export interface ParsedZshrc {
  found: boolean;
  accounts: ParsedAccount[];
  /** Notes about the function as a whole (e.g. commands after `esac` that were not taken over). */
  warnings: string[];
}

/** Body of `name() { ... }` / `function name { ... }`, by brace counting outside quotes. */
function functionBody(text: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\n)\\s*(?:function\\s+)?${name}\\s*(?:\\(\\s*\\))?\\s*\\{`);
  const m = re.exec(text);
  if (!m) return null;
  let depth = 1;
  let quote: string | null = null;
  const start = m.index + m[0].length;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i);
  }
  return null;
}

/** Splits on newlines and on `;` outside quotes; drops comments. `;;` stays a token of its own. */
function statements(body: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"' && i + 1 < body.length) cur += body[++i];
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === '#' && (cur === '' || /\s$/.test(cur))) {
      const nl = body.indexOf('\n', i);
      i = (nl === -1 ? body.length : nl) - 1;
    } else if (c === '\n') {
      out.push(cur);
      cur = '';
    } else if (c === ';') {
      out.push(cur);
      cur = '';
      if (body[i + 1] === ';') {
        out.push(';;');
        i++;
      }
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const unquote = (word: string) => word.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');

/** `export NAME=value` with a literal value; null value when it needs the shell to expand. */
function parseExport(stmt: string): { name: string; value: string | null } | null {
  const m = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(stmt);
  if (!m) return null;
  const raw = m[2].trim();
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) return { name: m[1], value: raw.slice(1, -1) };
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    const inner = raw.slice(1, -1);
    return { name: m[1], value: /[$`]/.test(inner) ? null : inner.replace(/\\(["\\$`])/g, '$1') };
  }
  if (/[$`\s"'\\]/.test(raw)) return { name: m[1], value: null };
  return { name: m[1], value: raw };
}

/** `"work"|"w")` → ['work', 'w']; null when the statement is not a case pattern. */
function parsePattern(stmt: string): { labels: string[]; rest: string } | null {
  const m = /^\(?\s*((?:"[^"]*"|'[^']*'|[\w.*-]+)(?:\s*\|\s*(?:"[^"]*"|'[^']*'|[\w.*-]+))*)\s*\)(.*)$/s.exec(stmt);
  if (!m) return null;
  return { labels: m[1].split('|').map((s) => unquote(s.trim())), rest: m[2].trim() };
}

export function parseZshrc(text: string): ParsedZshrc {
  const body = functionBody(text, ZSHRC_FUNCTION);
  if (body == null) return { found: false, accounts: [], warnings: [] };

  const accounts: ParsedAccount[] = [];
  const warnings: string[] = [];
  let inCase = false;
  let current: ParsedAccount | null = null;
  let afterCase = false;

  const handleBranchStatement = (acc: ParsedAccount, stmt: string) => {
    if (stmt.startsWith('export ')) {
      const e = parseExport(stmt);
      if (!e) {
        acc.warnings.push('有一行 export 无法识别，未导入');
      } else if (e.value === null) {
        acc.warnings.push(`${e.name} 的值引用了其他变量或命令，未导入值，请手工填写`);
        acc.env.push({ name: e.name, secret: isSecretEnvName(e.name), value: '' });
      } else {
        acc.env = acc.env.filter((x) => x.name !== e.name);
        acc.env.push({ name: e.name, secret: isSecretEnvName(e.name), value: e.value });
      }
    } else if (!/^(echo|printf|:)\b/.test(stmt)) {
      acc.warnings.push(`分支中的命令「${stmt.split(/\s+/)[0]}」未导入`);
    }
  };

  for (const stmt of statements(body)) {
    if (!inCase) {
      if (/^case\s+.+\s+in$/.test(stmt) || /^case\s+.+\s+in\s/.test(stmt)) {
        inCase = true;
        const tail = stmt.replace(/^case\s+\S+\s+in\s*/, '');
        if (tail) {
          const p = parsePattern(tail);
          if (p) {
            current = { account: p.labels[0], labels: p.labels, aliases: [], env: [], warnings: [] };
            if (p.rest) handleBranchStatement(current, p.rest);
          }
        }
      } else if (afterCase && !/^(local|shift|unset|echo|printf|return)\b/.test(stmt)) {
        const cmd = stmt.split(/\s+/)[0];
        warnings.push(`函数在 case 之后还会执行「${cmd}」，其中可能附加的启动参数未导入，请按需填到“启动参数”`);
      }
      continue;
    }
    if (stmt === 'esac') {
      if (current) accounts.push(current);
      current = null;
      inCase = false;
      afterCase = true;
      continue;
    }
    if (stmt === ';;') {
      if (current) accounts.push(current);
      current = null;
      continue;
    }
    if (!current) {
      const p = parsePattern(stmt);
      if (!p) continue;
      current = { account: p.labels[0], labels: p.labels, aliases: [], env: [], warnings: [] };
      if (p.rest) handleBranchStatement(current, p.rest);
      continue;
    }
    handleBranchStatement(current, stmt);
  }

  // A catch-all `*)` branch is the error message, not an account.
  const real = accounts.filter((a) => !a.labels.includes('*') && a.env.length > 0);

  const aliasRe = new RegExp(`^\\s*alias\\s+([\\w.-]+)=(['"])\\s*${ZSHRC_FUNCTION}\\s+([\\w.-]+)[^'"]*\\2`, 'gm');
  for (const m of text.matchAll(aliasRe)) {
    const acc = real.find((a) => a.labels.includes(m[3]));
    if (acc && !acc.aliases.includes(m[1])) acc.aliases.push(m[1]);
  }
  return { found: true, accounts: real, warnings: [...new Set(warnings)] };
}

/** Never shows a secret, not even its first characters. */
export function maskPreview(name: string, value: string, secret: boolean): string {
  if (!value) return '（空）';
  if (secret) return `••••••（${value.length} 位）`;
  return redact(value);
}

export function suggestedProfileName(account: ParsedAccount): string {
  return `CC-${account.account}`;
}
