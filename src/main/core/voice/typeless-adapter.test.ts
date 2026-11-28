import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TypelessAdapter } from './typeless-adapter';

it('discovers voice settings only in the configured isolated home', async () => {
  const root = await mkdtemp(join(tmpdir(), 'willyou-voice-home-'));
  try {
    const system = join(root, 'system');
    const isolated = join(root, 'isolated');
    for (const [home, shortcut] of [[system, 'RightOption'], [isolated, 'Fn+Space']] as const) {
      const dir = join(home, 'Library/Application Support/Typeless');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'app-settings.json'), JSON.stringify({ featureShortcutBindings: { dictationMode: [shortcut] } }));
    }
    const adapter = new TypelessAdapter('/not-used', isolated);
    adapter.supported = true;
    expect((await adapter.candidates()).map(candidate => candidate.shortcut)).toEqual(['Fn+Space']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
