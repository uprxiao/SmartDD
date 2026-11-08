import{MAC_KEY_CODES}from'./key-codes.mjs';
const modifiers = new Set([54, 55, 56, 58, 59, 60, 61, 62, 63]);
const families = { 54: 'Command', 55: 'Command', 56: 'Shift', 60: 'Shift', 58: 'Alt', 61: 'Alt', 59: 'Control', 62: 'Control', 63: 'Fn' };
const order = ['Command', 'Control', 'Alt', 'Shift', 'Fn'];
const normalize = (s) => s.replace(/[\s_-]/g, '').toLowerCase();

/** No scripts, no arbitrary characters, no empty tokens or multiple printable keys. */
export function parseShortcut(shortcut) {
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

