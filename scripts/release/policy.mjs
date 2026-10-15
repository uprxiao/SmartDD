import { join } from 'node:path';
import { readJson, root } from './common.mjs';

export function releasePolicy(config = readJson(join(root, 'release.config.json'))) {
  if (!['preview', 'stable'].includes(config.channel)) throw new Error('Release channel must be preview or stable');
  return { channel: config.channel, prerelease: config.channel === 'preview', requireMacSigning: config.channel === 'stable' };
}
