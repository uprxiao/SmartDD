import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
/** Read-only executable discovery; never installs or starts a language server. */
export async function discoverLanguageServers() {
  const directories = [...new Set([...(process.env.PATH ?? '').split(delimiter), '/usr/bin', '/opt/homebrew/bin', '/usr/local/bin'].filter(isAbsolute))];
  const candidates = [
    { name: 'clangd', languages: ['c', 'cpp', 'objective-c', 'objective-cpp'], args: ['--background-index=false', '--clang-tidy=false', '--enable-config=false'] },
    { name: 'typescript-language-server', languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'], args: ['--stdio'] },
    { name: 'pylsp', languages: ['python'], args: [] },
  ];
  const found: { name: string; command: string; languages: string[]; args: string[] }[] = [];
  for (const candidate of candidates) for (const directory of directories) {
    try { const command = await realpath(join(directory, candidate.name + (process.platform === 'win32' ? '.exe' : ''))); await access(command, constants.X_OK); found.push({ ...candidate, command }); break; } catch { /* absent executable */ }
  }
  return found;
}
