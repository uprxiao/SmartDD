// Deterministic, data-only renderer/RPC metadata from the compiled module registry.
import { build } from 'vite';
import { builtinModules, createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { write: { type: 'boolean', default: false }, output: { type: 'string' }, 'scratch-root':{type:'string'} } });
const root = resolve('.'), output = resolve(values.output ?? 'src/shared/application-module-catalog.json');
const scratchRoot=values['scratch-root']?resolve(values['scratch-root']):join(root,'out');
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, '.module-metadata-'));
if(values['scratch-root'])symlinkSync(join(root,'node_modules'),join(scratch,'node_modules'),'dir');
try {
  await build({ configFile: false, publicDir: false, logLevel: 'error', resolve: { alias: { '@shared': join(root, 'src/shared'), '@main': join(root, 'src/main'), '@root': root } },
    build: { ssr: join(root, 'src/main/core/applications/modules/index.ts'), target: 'node22', outDir: scratch, minify: false, sourcemap: false,
      rollupOptions: { external: id => id.startsWith('node:') || builtinModules.includes(id) || (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@shared/') && !id.startsWith('@main/') && !id.startsWith('@root/')),
        output: { format: 'cjs', entryFileNames: 'modules.cjs', inlineDynamicImports: true } } } });
  const { builtinApplicationModules: modules } = createRequire(import.meta.url)(join(scratch, 'modules.cjs'));
  const metadata = { schema: 'willyou-app-module-catalog-v1', applications: modules.registered.map(module => ({
    appId: module.appId, slots: [...module.slots], stopBeforeSwitch: module.stopBeforeSwitch,contractMajors:[...module.contractMajors],
    capabilities:Object.values(module.capabilities).map(({method:_method,...capability})=>({...capability,legacyTool:module.legacyToolNames?.[capability.id]??null})),
    presentation: module.presentation, providers: module.providers.map(provider => modules.providerPresentation(provider.id)),
  })) };
  const bytes = JSON.stringify(metadata, null, 2) + '\n';
  let old = null; try { old = readFileSync(output, 'utf8'); } catch {}
  if (values.write) { if (old !== bytes) writeFileSync(output, bytes); }
  else if (old !== bytes) throw Error('Application module metadata is stale; run node scripts/applications/generate-module-metadata.mjs --write');
  console.log(JSON.stringify({ metadata: output, applications: metadata.applications.length, providers: metadata.applications.reduce((n, m) => n + m.providers.length, 0), changed: old !== bytes, written: values.write }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
