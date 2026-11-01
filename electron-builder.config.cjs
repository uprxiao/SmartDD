// Adapted from ../yoda/electron-builder.config.ts (Apache-2.0); see NOTICE.
const signed = process.env.SMARTDD_SIGN === '1';

module.exports = {
  appId: 'com.smartdd.desktop',
  productName: 'WillYou',
  directories: { output: 'release' },
  artifactName: 'WillYou-${version}-${os}-${arch}.${ext}',
  files: ['out/**', '!out/native/**', '!out/capability-bundles/**', '!out/capability-bundles-compatibility-v1/**', 'NOTICE', 'licenses/**'],
  asarUnpack: ['node_modules/better-sqlite3/**', 'node_modules/node-pty/**', '**/*.node'],
  // Rebuild these two modules explicitly, using the target Electron ABI.
  npmRebuild: false,
  forceCodeSigning: signed,
  publish: null,
  afterPack: require('./scripts/release/mac-bundle-metadata.cjs'),
  mac: {
    icon: 'build/icons/icon.icns',
    extraResources: [
      { from: 'out/native/smartdd-voice', to: 'native/smartdd-voice' },
      { from: 'out/native/willyou-files', to: 'native/willyou-files' },
      { from: 'out/native/willyou-foxmail', to: 'native/willyou-foxmail' },
      { from: 'out/native/willyou-process-identity', to: 'native/willyou-process-identity' },
      { from: 'out/capability-bundles', to: 'capability-bundles' },
      { from: 'out/native/tex', to: 'native/tex' },
      { from: 'out/native/office', to: 'native/office' },
      { from: 'out/native/libreoffice', to: 'native/libreoffice' },
    ],
    binaries: ['Contents/Resources/native/smartdd-voice', 'Contents/Resources/native/willyou-files', 'Contents/Resources/native/willyou-foxmail', 'Contents/Resources/native/willyou-process-identity', 'Contents/Resources/native/tex/tectonic', 'Contents/Resources/native/office/jre/bin/java'],
    // Preserve the complete vendor-signed LibreOffice bundle, including its
    // nested launch constraints. The enclosing WillYou signature still seals
    // this resource, and runtime verification checks both seals and file hashes.
    signIgnore: ['[/\\\\]native[/\\\\]libreoffice[/\\\\]LibreOffice\\.app(?:[/\\\\]|$)'],
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: signed,
    // Preview has no Developer ID/notarization. Still seal the bundle with an
    // ad-hoc identity so macOS attributes the native key bridge to SmartDD,
    // rather than Electron's unbound linker signature / executable path.
    ...(signed ? {} : { identity: '-', timestamp: 'none' }),
  },
  win: { icon: 'build/icons/icon.ico', target: [{ target: 'nsis', arch: ['x64'] }, { target: 'msi', arch: ['x64'] }] },
  msi: { oneClick: false, perMachine: false },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
  linux: {
    icon: 'build/icons/png',
    category: 'Development',
    executableName: 'willyou',
    maintainer: 'WillYou contributors',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
};
