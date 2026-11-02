import { builtinModules } from 'node:module';
import { isAbsolute, win32 } from 'node:path';

// Rollup can pass Windows drive and UNC paths even when its diagnostic renders
// the entry relative to the repository. Source paths must remain in the bundle.
export function isExternalMetadataImport(id) {
  return id.startsWith('node:') || builtinModules.includes(id) || (
    !isAbsolute(id) && !win32.isAbsolute(id) &&
    !id.startsWith('.') && !id.startsWith('@shared/') &&
    !id.startsWith('@main/') && !id.startsWith('@root/')
  );
}
