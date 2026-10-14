import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DirStatus } from '@shared/projects';

export function inspectDir(path: string): DirStatus {
  const status: DirStatus = { exists: false, isDirectory: false, readable: false, writable: false, vcs: null, available: false };
  try {
    status.isDirectory = statSync(path).isDirectory();
    status.exists = true;
  } catch {
    return status;
  }
  status.readable = can(path, constants.R_OK | constants.X_OK);
  status.writable = can(path, constants.W_OK);
  status.vcs = detectVcs(path);
  status.available = status.isDirectory && status.readable;
  return status;
}

function can(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

/** Walks up looking for a working-copy marker. Reads only; never runs svn/git. */
function detectVcs(start: string): 'svn' | 'git' | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.svn'))) return 'svn';
    if (existsSync(join(dir, '.git'))) return 'git';
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Key used to decide "same path": realpath when it exists (symlinks, /tmp → /private/tmp). */
export function pathIdentity(path: string): string {
  const abs = resolve(path);
  try {
    // .native also canonicalises letter case on case-insensitive APFS.
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}
