import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test fixtures only. ssh2 1.17's ed25519 generator strips leading zero bytes from the
 * public key (keygen.js parseDERs), sporadically producing a 31-byte invalid key.
 * System OpenSSH generates correctly encoded keys; the tests still exercise ssh2 parsing.
 */
export function generateSshTestKey(passphrase = ''): { public: string; private: string } {
  const dir = mkdtempSync(join(tmpdir(), 'smartdd-ssh-key-'));
  const file = join(dir, 'key');
  try {
    execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', passphrase, '-f', file], { stdio: 'pipe', timeout: 5000 });
    return { public: readFileSync(file + '.pub', 'utf8'), private: readFileSync(file, 'utf8') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
