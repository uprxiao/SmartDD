export default {
  root: '/Users/hx/hx/hxWork/SmartDD',
  resolve: { alias: {
    '@root': '/Users/hx/hx/hxWork/SmartDD',
    '@shared': '/Users/hx/hx/hxWork/SmartDD/src/shared',
    '@main': '/Users/hx/hx/hxWork/SmartDD/src/main',
    '@renderer': '/Users/hx/hx/hxWork/SmartDD/src/renderer',
    vitest: '/Users/hx/hx/hxWork/SmartDD/node_modules/vitest/dist/index.js',
  } },
  test: { include: ['/private/tmp/willyou-h24-acceptance/mode-switch-acceptance.test.ts'], environment: 'node' },
};
