import { mergeConfig } from 'vitest/config';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import original from './vitest.config';

// This private runner's symlinked immutable dependencies live outside its cwd.
// Match the normal checkout/CI trust boundary without disabling Vite fs.strict.
export default mergeConfig(original, { server: { fs: { strict: true, allow: [realpathSync(resolve('.')), realpathSync(resolve('node_modules'))] } } });
