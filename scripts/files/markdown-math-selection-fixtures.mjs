const eol = '\r\n';
export const mathSelectionFixtures = [
  ...Object.entries({ paragraph: '', heading: '  ## ', quote: '> ', list: '- ' }).map(([name, prefix]) => ({ name, code: 'a^2', after: 'u+v', marker: '$', source: ['# Prefix', '', prefix + '中文😀 $a^2$ 与 $b_1$', '', 'Other $z$', '', 'Tail', ''].join(eol), siblings: ['b_1', 'z'] })),
  ...Object.entries({ block: '$$\r\na+b\r\n$$', 'quote-block': '> $$\r\n> a+b\r\n> $$', 'list-block': '- $$\r\n  a+b\r\n  $$', eqno: '$$a+b$$ (eq-1)' }).map(([name, formula]) => ({ name, code: name === 'quote-block' ? ' a+b ' : name === 'list-block' ? '\n  a+b\n  ' : name === 'eqno' ? 'a+b' : '\na+b\n', after: 'u+v', marker: '$$', source: ['# Prefix', '', formula, '', 'Other $z$', '', 'Tail', ''].join(eol), siblings: ['z'] })),
];
