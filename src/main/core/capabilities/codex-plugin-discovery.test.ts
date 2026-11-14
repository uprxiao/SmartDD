import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { discoverCapabilities, type DiscoveryContext } from './discovery';

let root: string;
let context: DiscoveryContext;
const file = (path: string, contents: string) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
};
function plugin(name: string, version: string, portable = false) {
  const base = `codex/plugins/cache/local/${name}/${version}`;
  file(`${base}/${portable ? 'plugin.json' : '.codex-plugin/plugin.json'}`, JSON.stringify({
    ...(portable ? { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' } : {}), name, version,
  }));
  file(`${base}/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: public fixture\n---\n${version}\n`);
  file(`${base}/${portable ? 'mcp.json' : '.mcp.json'}`, JSON.stringify({
    ...(portable ? { $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json' } : {}),
    mcpServers: { [name]: { ...(portable ? { type: 'stdio', command: 'true' } : { command: '/usr/bin/true', enabled: true }), env: { TOKEN: 'PUBLIC_VALUE_NOT_FOR_DISCOVERY' } } },
  }));
  return base;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'willyou-codex-plugin-'));
  mkdirSync(join(root, 'project/.git'), { recursive: true });
  context = { runner: 'codex', home: join(root, 'home'), stateRoot: join(root, 'codex'), cwd: join(root, 'project'), path: '/usr/bin:/bin', nativeVersion: '0.167.1' };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('discovers only an installed selected version, using native semantic version ordering', () => {
  file('codex/config.toml', '[plugins."sample@local"]\nenabled=true\n');
  plugin('sample', '2.9.0'); const current = plugin('sample', '2.10.0'); plugin('unused', '9.0.0');
  const definitions: Record<string, unknown>[] = [];
  const rows = discoverCapabilities({ ...context, onMcpDefinition: (_row, definition) => definitions.push(definition) });
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.path.startsWith(join(root, current)))).toBe(true);
  expect(rows.every(row => row.source === 'plugin:sample@local' && row.enabled === true && row.loaded === 'unverified')).toBe(true);
  expect(definitions).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain('PUBLIC_VALUE_NOT_FOR_DISCOVERY');
});

it('prefers the native local version and keeps a disabled plugin disabled despite server enabled=true', () => {
  file('codex/config.toml', '[plugins."sample@local"]\nenabled=false\n');
  plugin('sample', '99.0.0'); const current = plugin('sample', 'local');
  const rows = discoverCapabilities(context);
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.path.startsWith(join(root, current)) && row.enabled === false)).toBe(true);
});

it('orders prerelease and build identifiers numerically rather than as directory text', () => {
  file('codex/config.toml', '[plugins."sample@local"]\nenabled=true\n');
  plugin('sample', '1.0.0-rc.99'); plugin('sample', '1.0.0+2'); const current = plugin('sample', '1.0.0+10');
  expect(discoverCapabilities(context).every(row => row.path.startsWith(join(root, current)))).toBe(true);
});

it('recognizes persisted remote installation identity without inventing server-side enabled state', () => {
  const base = plugin('remote', '1.0.0');
  file('codex/plugins/cache/local/remote/.codex-remote-plugin-install.json', JSON.stringify({ schema_version: 1, remote_plugin_id: 'public-plugin-id' }));
  plugin('unused', '2.0.0');
  const rows = discoverCapabilities(context);
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.path.startsWith(join(root, base)) && row.enabled === null && row.loaded === 'unverified')).toBe(true);
});

it('uses portable manifest precedence and direct-child Skills, not stale legacy declarations', () => {
  file('codex/config.toml', '[plugins."portable@local"]\nenabled=true\n');
  const base = plugin('portable', '1.0.0', true);
  file(`${base}/.codex-plugin/plugin.json`, JSON.stringify({ name: 'stale', skills: './stale-skills' }));
  file(`${base}/stale-skills/stale/SKILL.md`, '---\nname: stale\ndescription: stale\n---\n');
  file(`${base}/skills/deep/nested/SKILL.md`, '---\nname: nested\ndescription: nested\n---\n');
  const rows = discoverCapabilities(context);
  expect(rows.filter(row => row.kind === 'skill').map(row => row.name)).toEqual(['portable']);
  expect(rows.find(row => row.kind === 'mcp')?.path).toBe(join(root, base, 'mcp.json'));
});

it('does not follow cache version symlinks or manifest traversal paths', () => {
  file('codex/config.toml', '[plugins."escape@local"]\nenabled=true\n[plugins."linked@local"]\nenabled=true\n');
  const base = plugin('escape', '1.0.0');
  file(`${base}/.codex-plugin/plugin.json`, JSON.stringify({ name: 'escape', skills: './../outside', mcpServers: './../outside.json' }));
  file('codex/plugins/cache/local/escape/outside/x/SKILL.md', '---\nname: outside\ndescription: public\n---\n');
  const external = plugin('external', '1.0.0');
  mkdirSync(join(root, 'codex/plugins/cache/local/linked'), { recursive: true });
  symlinkSync(join(root, external), join(root, 'codex/plugins/cache/local/linked/1.0.0'));
  const rows = discoverCapabilities(context);
  expect(rows.some(row => row.name === 'outside' || row.name === 'external')).toBe(false);
});

it('normalizes portable root/data placeholders and preserves literal user environment references', () => {
  file('codex/config.toml', '[plugins."portable@local"]\nenabled=true\n');
  const base = plugin('portable', '1.0.0', true);
  file(`${base}/mcp.json`, JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {
    portable: { type: 'stdio', command: './bin/run', args: ['${PLUGIN_ROOT}/input', '${PLUGIN_DATA}/state', '${USER_VAR}'], env: { DATA: '${PLUGIN_DATA}' } },
  } }));
  file(`${base}/bin/run`, '#!/bin/sh\nexit 0\n');
  let declaration: Record<string, unknown> | undefined;
  discoverCapabilities({ ...context, onMcpDefinition: (_row, raw) => { declaration = raw; } });
  expect(declaration).toMatchObject({ command: join(root, base, 'bin/run'), cwd: join(root, base) });
  expect((declaration?.args as string[])[0]).toBe(join(root, base, 'input'));
  expect((declaration?.args as string[])[2]).toBe('${USER_VAR}');
  expect((declaration?.env as Record<string, string>).PLUGIN_DATA).toMatch(/\/plugins\/data\/agent-plugins\/[a-f0-9]{64}$/);
});

it('leaves unsupported portable schemas and reserved environment overrides unavailable', () => {
  file('codex/config.toml', '[plugins."portable@local"]\nenabled=true\n');
  const base = plugin('portable', '1.0.0', true);
  file(`${base}/mcp.json`, JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', mcpServers: {
    bad: { type: 'stdio', command: 'true', env: { PLUGIN_ROOT: '/outside', TOKEN: 'PUBLIC_UNSUPPORTED_VALUE' } },
  } }));
  const definitions: unknown[] = [];
  const rows = discoverCapabilities({ ...context, onMcpDefinition: (_row, raw) => definitions.push(raw) });
  expect(rows.some(row => row.issues.includes('plugin_mcp_unverified'))).toBe(true);
  expect(definitions).toEqual([]);
  expect(JSON.stringify(rows)).not.toContain('PUBLIC_UNSUPPORTED_VALUE');
  file(`${base}/plugin.json`, JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/9.0.0/plugin.schema.json', name: 'portable' }));
  expect(discoverCapabilities(context).some(row => row.kind === 'skill')).toBe(false);
});
