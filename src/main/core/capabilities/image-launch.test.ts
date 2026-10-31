import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { imageInputLaunchSchema, imageInputMode } from '@shared/terminal-image';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('reports the actual resolved executable bytes after launch environment resolution without retaining args', () => {
  const root = mkdtempSync(join(tmpdir(), 'm9-image-launch-')); roots.push(root);
  const executable = join(root, 'real-cli'), alias = join(root, 'selected-cli');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 }); symlinkSync(executable, alias);
  const modes = [[], ['--bare', '--tools', '', '--setting-sources', '', '--session-id', 'own-id'], ['--print', '--input-format', 'stream-json'], ['--unreviewed-switch'], ['--tools'], ['--mcp-config', '/own/config.json', 'M9_SYNTHETIC_PROMPT_NEVER_LOGGED']];
  const script = "import json,runpy,sys; f=runpy.run_path(sys.argv[1])['image_input_launch']; print(json.dumps([f([sys.argv[2]]+args, {'runId':'own-run'}) for args in json.loads(sys.argv[3])]))";
  const raw = execFileSync('/usr/bin/python3', ['-c', script, resolve('resources/runtime/launch.py'), alias, JSON.stringify(modes)], { encoding: 'utf8', timeout: 5000 });
  expect(raw).not.toContain('M9_SYNTHETIC_PROMPT_NEVER_LOGGED'); expect(raw).not.toContain('/own/config.json');
  const rows = JSON.parse(raw).map((row: unknown) => imageInputLaunchSchema.parse(row));
  for (let at = 0; at < rows.length; at++) {
    const row = rows[at]; expect(row.executable).toBe(realpathSync(executable)); expect(row.sha256).toBe(createHash('sha256').update(readFileSync(executable)).digest('hex'));
    expect(row.inode).toBe(String(statSync(executable, { bigint: true }).ino)); expect(row.runId).toBe('own-run'); expect(row.mode).toBe(imageInputMode(modes[at]));
  }
});
