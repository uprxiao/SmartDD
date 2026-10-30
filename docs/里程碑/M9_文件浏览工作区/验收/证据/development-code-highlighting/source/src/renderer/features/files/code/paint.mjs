// Worker DTO: UTF-16 from/to, light RGB, dark RGB, light/dark TextMate font-style bits.
export const CODE_TOKEN_STRIDE = 6;
const color = value => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new Error('Invalid syntax color');
  return '#' + value.toString(16).padStart(6, '0');
};
const font = value => {
  if (!Number.isInteger(value) || value < 0 || value > 15) throw new Error('Invalid syntax font style');
  return { style: value & 1 ? 'italic' : 'normal', weight: value & 2 ? 'bold' : 'normal', decoration: [value & 4 ? 'underline' : '', value & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || 'none' };
};
export function codeTokenStyle(tokens, index) {
  const light = font(tokens[index + 4]), dark = font(tokens[index + 5]);
  let style = `--fw-token-light:${color(tokens[index + 2])};--fw-token-dark:${color(tokens[index + 3])}`;
  // Normal styles use CSS defaults, avoiding six repeated declarations per token
  // in bounded Markdown/Notebook window payloads.
  for (const [mode, value] of [['light', light], ['dark', dark]]) {
    if (value.style !== 'normal') style += `;--fw-token-${mode}-style:${value.style}`;
    if (value.weight !== 'normal') style += `;--fw-token-${mode}-weight:${value.weight}`;
    if (value.decoration !== 'none') style += `;--fw-token-${mode}-decoration:${value.decoration}`;
  }
  return style;
}
