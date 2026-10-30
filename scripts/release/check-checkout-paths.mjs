// Keep tracked paths checkable on the standard Windows Actions workspace.
// Historical POSIX-only evidence belongs in an archive, with original hashes.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const windowsCheckoutRoot = 'D:\\a\\SmartDD\\SmartDD';

export function windowsCheckoutIssue(path, checkoutRoot = windowsCheckoutRoot) {
  for (const component of path.split('/')) {
    if (/[<>:"\\|?*\x00-\x1f]/.test(component)) return 'Windows-reserved character';
    if (/[ .]$/.test(component)) return 'Trailing space or dot';
    if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(component)) return 'Windows device name';
  }
  // JavaScript string length counts UTF-16 code units, as Windows does here.
  if (checkoutRoot.length + 1 + path.length >= 260) return 'Default Windows runner path exceeds MAX_PATH';
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const paths = execFileSync('git', ['ls-files', '-z'], {
    cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const failures = paths.flatMap(path => {
    const issue = windowsCheckoutIssue(path);
    return issue ? [{ path, issue }] : [];
  });
  if (failures.length) {
    console.error(JSON.stringify({ incompatibleTrackedPaths: failures }, null, 2));
    process.exitCode = 1;
  } else console.log(`Windows checkout paths verified: ${paths.length} tracked files`);
}
