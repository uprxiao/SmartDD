import { MAC_KEY_CODES } from './key-codes';
import type { ShortcutCandidate } from '@shared/voice';

const modifiers = new Set([54, 55, 56, 58, 59, 60, 61, 62, 63]);
const families: Record<number, string> = { 54: 'Command', 55: 'Command', 56: 'Shift', 60: 'Shift', 58: 'Alt', 61: 'Alt', 59: 'Control', 62: 'Control', 63: 'Fn' };
const order = ['Command', 'Control', 'Alt', 'Shift', 'Fn'];
const normalize = (s: string) => s.replace(/[\s_-]/g, '').toLowerCase();

/** No scripts, no arbitrary characters, no empty tokens or multiple printable keys. */
export function parseShortcut(shortcut: string) {
  if (!shortcut || shortcut.length > 80) throw new Error('INVALID_SHORTCUT');
  const tokens = shortcut.split('+').map(normalize);
  const codes = tokens.map(token => MAC_KEY_CODES[token]);
  if (codes.some(code => code === undefined) || new Set(codes).size !== codes.length || codes.length > 5) throw new Error('INVALID_SHORTCUT');
  const regular = codes.filter(code => !modifiers.has(code));
  const mods = codes.filter(code => modifiers.has(code));
  if (regular.length > 1 || new Set(mods.map(c => families[c])).size !== mods.length) throw new Error('INVALID_SHORTCUT');
  if (regular.length && codes.at(-1) !== regular[0]) throw new Error('INVALID_SHORTCUT');
  const canonical = [...mods.map(c => families[c]).sort((a, b) => order.indexOf(a) - order.indexOf(b)), ...regular.map(String)].join('+');
  return { codes, canonical, tokens, regular, mods };
}

export function globalAccelerator(shortcut: string): string {
  const p = parseShortcut(shortcut);
  const key = p.tokens.at(-1)!;
  // Restrict to portable Electron accelerators; side-specific keys and Fn remain Typeless-only.
  if (!p.mods.length || p.regular.length !== 1 || p.tokens.some(t => /^(left|right)/.test(t) || t === 'fn' || t === 'function') || !/^(space|[a-z0-9]|f(?:[1-9]|1[0-9]|20))$/.test(key)) throw new Error('INVALID_SHORTCUT');
  const reserved = ['Command+N', 'Command+K', 'Command+B', 'Command+W', 'Command+Q', 'Command+Return', 'Command+Comma', 'Command+C', 'Command+V', 'Command+X', 'Command+A', 'Command+Z', 'Command+Shift+Z', 'Command+H', 'Command+M', 'Command+R', 'Command+Shift+R', 'Command+Alt+I', 'Control+Command+F', 'Command+0'];
  if (reserved.some(s => parseShortcut(s).canonical === p.canonical)) throw new Error('GLOBAL_CONFLICT');
  return [...p.mods.map(c => families[c]).sort((a, b) => order.indexOf(a) - order.indexOf(b)), key === 'space' ? 'Space' : key.toUpperCase()].join('+');
}

export function shortcutCandidates(settings: unknown): ShortcutCandidate[] {
  if (!settings || typeof settings !== 'object') return [];
  const root = settings as Record<string, unknown>;
  const found: ShortcutCandidate[] = [];
  for (const [group, names] of Object.entries({ featureShortcutBindings: ['dictationMode', 'handsFreeMode', 'handlesFreeMode'], keyboardShortcut: ['handsFreeMode', 'handlesFreeMode', 'pushToTalk'] })) {
    const fields = root[group];
    if (!fields || typeof fields !== 'object') continue;
    for (const name of names) {
      const raw = (fields as Record<string, unknown>)[name];
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (typeof v !== 'string') continue;
        try { parseShortcut(v); found.push({ shortcut: v.trim(), source: `${group}.${name}` }); } catch { /* Ignore unknown keys, never guess. */ }
      }
    }
  }
  return found;
}

export function resolveCandidate(candidates: ShortcutCandidate[]): string | null {
  const clickCandidates = candidates.filter(c => c.source !== 'keyboardShortcut.pushToTalk');
  const unique = new Set(clickCandidates.map(c => parseShortcut(c.shortcut).canonical));
  // Conflicting versions/modes need manual confirmation; askAnything is deliberately excluded.
  return unique.size === 1 ? clickCandidates[0].shortcut : null;
}
