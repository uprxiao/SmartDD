// Synthetic fixtures shared by isolated M8 tests; never loaded by the application.
import type { PortableProject } from './transfer-format';
export function transferFixture(): PortableProject {
  return {
    schemaVersion: 1, exportedAt: '2026-10-16T00:00:00.000Z', producer: { name: 'WillYou', appVersion: '0.0.4', platform: 'darwin' },
    project: { name: '迁移项目', aliases: ['测试'], description: '中文与资源', rulesPath: null },
    directories: [{ ref: 'dir-1', label: '主目录', path: '/source/project', isDefault: true }],
    databases: [{ ref: 'db-1', env: 'dev', label: '测试库', aliases: ['库'], vendor: 'mysql', host: '127.0.0.1', port: 3306, database: 'test', schema: null, username: 'tester', accessLevel: 'readonly', isDefault: true, note: '' }],
    servers: [{ ref: 'ssh-1', env: 'dev', label: '测试服务器', aliases: [], host: '127.0.0.1', port: 22, username: 'tester', authType: 'password', privateKeyPath: null, defaultRoot: true, sudoPolicy: 'separate', appRoot: '/remote/project', logsPath: '/remote/log', note: '' }],
    capabilities: [{ id: 'project-db-diagnostics', enabled: true }, { id: 'remote-password-ssh', enabled: false }, { id: 'smartdd-project-context', enabled: true }],
    profiles: [{ ref: 'ai-1', name: '测试配置', runner: 'claude', executable: '/source/bin/claude', args: ['--model', 'test'], color: '#3b82f6', env: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: null }, { name: 'MODEL', secret: false, value: 'synthetic' }] }],
    credentials: { 'db-1': { password: 'synthetic-db-password' }, 'ssh-1': { password: 'synthetic-ssh-password', sudoPassword: 'synthetic-sudo-password' }, 'ai-1': { env: { ANTHROPIC_API_KEY: 'synthetic-token-m8' } } },
  };
}
