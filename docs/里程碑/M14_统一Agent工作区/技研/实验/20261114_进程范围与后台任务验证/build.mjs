import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
const root = '/Users/hx/projects/t3code';
const dir = new URL('.', import.meta.url).pathname;
const adapterPath = root + '/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts';
const adapter = await readFile(adapterPath, 'utf8');
const start = adapter.indexOf('const CLAUDE_GROUP_WATCH_SCRIPT = [');
const end = adapter.indexOf('\ninterface ClaudeProcessRow', start);
if (start < 0 || end < 0) throw Error('source extraction markers missing');
const extracted = adapter.slice(start, end);
const groupPath = root + '/packages/provider-core/src/server/processGroup.ts';
const group = await readFile(groupPath, 'utf8');
await writeFile(dir + '/extracted.ts', `import * as NodeChildProcess from 'node:child_process';\n${group}\n${extracted}\n`);
await build({ entryPoints: [dir + '/extracted.ts'], outfile: dir + '/extracted.mjs', platform: 'node', bundle: true, format: 'esm' });
await writeFile(dir + '/source-evidence.json', JSON.stringify({
  scope: 'Unmodified contiguous function/script extraction plus unmodified processGroup.ts; TypeScript types erased. Full adapter, AgentScope, descendant polling and Effect services are not executed.',
  sources: [{ path: adapterPath, sha256: createHash('sha256').update(adapter).digest('hex'), extractedSha256: createHash('sha256').update(extracted).digest('hex') }, { path: groupPath, sha256: createHash('sha256').update(group).digest('hex') }],
}, null, 2));
