import type { NativeFileBroker } from '../native-broker';
import { FileEngineWorkspaces } from '../engine-workspaces';
export type { EngineCleanupReport as TexCleanupReport } from '../engine-workspaces';

/** Preserve the existing TeX workspace layout and recovery identity. */
export class TexWorkspaces extends FileEngineWorkspaces {
  constructor(userData: string, broker: NativeFileBroker) { super(userData, broker, 'tex'); }
}
