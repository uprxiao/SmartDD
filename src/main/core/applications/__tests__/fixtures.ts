import type { ApplicationManifest } from '@shared/applications';
import { digest } from '../manifest';
export function fixtureBundle(version = '1.0.0') {
  const files: Record<string, Buffer> = {
    'skills/query/SKILL.md': Buffer.from('---\nname: test-query\ndescription: Isolated fixture\n---\nUse the owned test tool.\n'),
    'adapter/index.cjs': Buffer.from('module.exports = { version: ' + JSON.stringify(version) + ' };\n'),
    'schemas/connection.json': Buffer.from('{"type":"object","properties":{},"additionalProperties":false}'),
    'schemas/input.json': Buffer.from('{"type":"object","properties":{},"additionalProperties":false}'),
    'schemas/output.json': Buffer.from('{"type":"object","properties":{},"additionalProperties":false}'),
  };
  const manifest: ApplicationManifest = {
    schema: 'smartdd-app-package-v1', appId: 'zentao', version, displayName: '禅道', description: 'Isolated application package fixture',
    hostApi: { min: 1, max: 1 }, dataApi: 1,
    connectionContracts: [{ providerId: 'zentao', configApiMajor: 1, identityContractMajor: 1, inputSchemaPath: 'schemas/connection.json', authModes: ['token'] }],
    runtime: { id: 'applications', hash: 'b'.repeat(64), protocolMajor: 1 },
    skills: [{ id: 'query', path: 'skills/query', entry: 'skills/query/SKILL.md', description: 'Read assigned objects' }],
    tools: [{ name: 'smartdd_zentao_query_v1', contractMajor: 1, inputSchemaPath: 'schemas/input.json', outputSchemaPath: 'schemas/output.json', permission: 'zentao.read', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }],
    adapter: { entry: 'adapter/index.cjs', format: 'cjs' }, migrations: [], permissions: ['zentao.read'],
    files: Object.entries(files).map(([path, content]) => ({ path, size: content.length, sha256: digest(content), executable: false })),
  };
  return { manifest, files };
}
