import { describe, expect, it } from 'vitest';
import { CLAUDE_PNG_ADAPTER, imageInputCapability, imageInputMode, terminalImageData, type ImageInputLaunch } from './terminal-image';
const launch = (change: Partial<ImageInputLaunch> = {}): ImageInputLaunch => ({ runId: 'own-run', pid: 123, executable: '/own/cli', device: '1', inode: '2', size: 99, mtimeNs: '1', sha256: CLAUDE_PNG_ADAPTER.sha256, mode: 'interactive', ...change });
describe('version-bound image input admission', () => {
  it('requires an actual known launch and interactive mode, rather than a CLI name', () => {
    expect(imageInputCapability(null).state).toBe('unknown');
    expect(imageInputCapability(launch({ sha256: 'a'.repeat(64), executable: '/bin/claude' })).state).toBe('unknown');
    expect(imageInputCapability(launch({ sha256: 'a'.repeat(64), mode: 'noninteractive' })).state).toBe('unknown');
    expect(imageInputCapability(launch({ mode: 'noninteractive' })).state).toBe('unsupported');
    expect(imageInputCapability(launch({ mode: 'unknown' })).state).toBe('unknown');
    expect(imageInputCapability(launch())).toMatchObject({ state: 'supported', adapterId: CLAUDE_PNG_ADAPTER.id, acceptedMimeTypes: ['image/png'] });
  });
  it('uses one explicit image paste frame with no submission or textual-path suffix', () => {
    expect(terminalImageData('/private/tmp/owned-123/image.png')).toBe('\x1b[200~/private/tmp/owned-123/image.png\x1b[201~');
    expect(terminalImageData('/private/tmp/owned-123/image.png')).not.toMatch(/[\r\n]/);
    for (const value of ['/tmp/a b/image.png', '/tmp/a\n/image.png', '/tmp/../image.png', 'image.png', '/tmp/"image".png']) expect(() => terminalImageData(value)).toThrow();
  });
  it('recognizes reviewed interactive args while refusing print and unknown modes', () => {
    expect(imageInputMode(['--bare', '--tools', '', '--setting-sources', '', '--session-id', 'own-id'])).toBe('interactive');
    expect(imageInputMode(['--mcp-config', '/own/mcp.json', '--plugin-dir', '/own/plugin', '--resume', 'own-id'])).toBe('interactive');
    expect(imageInputMode(['--bare', '--print', 'message never logged'])).toBe('noninteractive');
    expect(imageInputMode(['--unknown-mode'])).toBe('unknown'); expect(imageInputMode(['--tools'])).toBe('unknown');
  });
});
