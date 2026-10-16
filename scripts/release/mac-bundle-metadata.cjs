const { execFileSync } = require('node:child_process');
const path = require('node:path');

// File-provider-backed source folders can carry Finder metadata into generated
// bundles. Remove only the two non-code attributes codesign rejects. Preserve
// quarantine and every other security attribute; never operate on source apps.
module.exports = async function cleanGeneratedMacBundle(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  for (const attribute of ['com.apple.FinderInfo', 'com.apple.ResourceFork']) {
    execFileSync('/usr/bin/xattr', ['-dr', attribute, bundle], { stdio: 'pipe' });
  }
};
