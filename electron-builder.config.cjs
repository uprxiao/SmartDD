// Adapted from ../yoda/electron-builder.config.ts (Apache-2.0); see NOTICE.
const signed = process.env.SMARTDD_SIGN === '1';

module.exports = {
  appId: 'com.smartdd.desktop',
  productName: 'SmartDD',
  directories: { output: 'release' },
  artifactName: 'SmartDD-${version}-${os}-${arch}.${ext}',
  files: ['out/**', 'NOTICE', 'licenses/**'],
  asarUnpack: ['node_modules/better-sqlite3/**', 'node_modules/node-pty/**', '**/*.node'],
  // Rebuild these two modules explicitly, using the target Electron ABI.
  npmRebuild: false,
  forceCodeSigning: signed,
  publish: null,
  mac: {
    icon: 'build/icons/icon.icns',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: signed,
    ...(signed ? {} : { identity: null }),
  },
  win: { icon: 'build/icons/icon.ico', target: [{ target: 'nsis', arch: ['x64'] }, { target: 'msi', arch: ['x64'] }] },
  msi: { oneClick: false, perMachine: false },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  linux: {
    icon: 'build/icons/png',
    category: 'Development',
    executableName: 'smartdd',
    maintainer: 'SmartDD contributors',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
};
