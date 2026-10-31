import { build } from 'vite';
import { resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const legal = [...new Set(['licenses/M10/bridge/mcp-server-LICENSE.txt','licenses/M10/bridge/mcp-core-LICENSE.txt','licenses/M10/bridge/zod-LICENSE.txt'].map(path => readFileSync(path,'utf8')))].join('\n\n');
const entry = resolve('src/main/core/applications/bridge-runtime.ts');
export async function buildApplicationRuntime(output = resolve('out/applications')) {
  return build({ configFile: false,publicDir: false,resolve: { alias: { '@shared': resolve('src/shared') } },ssr: { noExternal: true },build: { ssr: entry,target: 'node22',outDir: output,emptyOutDir: false,minify: false,sourcemap: false,rollupOptions: { external: id => id.startsWith('node:') || builtinModules.includes(id),output: { banner: '/*! WillYou application bridge; bundled upstream license texts follow.\n' + legal.replaceAll('*/','* /') + '\n*/',format: 'cjs',entryFileNames: 'mcp-bridge.cjs',inlineDynamicImports: true } } } });
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await buildApplicationRuntime(process.argv[2] ? resolve(process.argv[2]) : undefined);
