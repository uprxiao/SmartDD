import { realpathSync } from 'node:fs';
import type { RuntimeSnapshot } from '@shared/capabilities';
import { canonicalJson,digest } from '../applications/manifest';

export type OriginalRunCleanup = 'remove' | 'hold' | 'retain-plugin';
interface Owner {
  pins: string;
  phase: OriginalRunCleanup;
  released: boolean;
  cleanup: (mode: OriginalRunCleanup) => void;
}
// Original run paths are globally unique in this host. The registry only contains
// cleanup closures created by CapabilityService; disk contents cannot create one.
const owners = new Map<string,Owner>();
function pins(snapshot: RuntimeSnapshot): string {
  const { selfCheck: _check,...fixed } = snapshot;
  return digest(canonicalJson(fixed));
}
/** A live runtime closure is authority only for its own tree's cleanup. This is
 * neither a native-process exit proof nor an API for adopting an unknown owner.
 */
export function registerOriginalRun(root: string,snapshot: RuntimeSnapshot,cleanup: Owner['cleanup']): () => void {
  const canonical = realpathSync(root);
  if (owners.has(canonical)) throw new Error('原运行目录已有另一释放句柄');
  const owner: Owner = { pins: pins(snapshot),phase: 'remove',released: false,cleanup };
  owners.set(canonical,owner);
  return () => {
    owner.released = true;
    cleanup(owner.phase);
    if (owner.phase !== 'hold' && owners.get(canonical) === owner) owners.delete(canonical);
  };
}

/** Called only after the matching source intent / durable references have been
 * verified by the host. Unknown roots simply remain unknown: nothing is claimed.
 */
export function retainOriginalRun(root: string,snapshot: RuntimeSnapshot,phase: 'intent' | 'committed'): boolean {
  let canonical: string;try { canonical = realpathSync(root); } catch { return false; }
  const owner = owners.get(canonical);
  if (!owner || owner.pins !== pins(snapshot)) return false;
  if (phase === 'intent' && owner.phase === 'remove') owner.phase = 'hold';
  if (phase === 'committed') owner.phase = 'retain-plugin';
  if (owner.released && owner.phase === 'retain-plugin') {
    owner.cleanup(owner.phase);
    if (owners.get(canonical) === owner) owners.delete(canonical);
  }
  return true;
}
