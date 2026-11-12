import {build} from 'vite';
import {cpSync,mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {builtinModules} from 'node:module';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** A complete external payload: JSON/assets/Skills and standalone JS, no host import at runtime. */
export async function buildZentaoPlugin(output=resolve('out/plugins/zentao')){
  const destination=resolve(output);mkdirSync(destination,{recursive:true});
  cpSync(resolve('plugins/zentao/package'),destination,{recursive:true});
  cpSync(resolve('plugins/zentao/SOURCE.md'),join(destination,'SOURCE.md'));
  const license=readFileSync('licenses/M10/bridge/zod-LICENSE.txt','utf8');
  await build({configFile:false,publicDir:false,resolve:{alias:{'@shared':resolve('src/shared')}},ssr:{noExternal:true},build:{ssr:resolve('plugins/zentao/src/main.ts'),target:'node24',outDir:join(destination,'runtime'),emptyOutDir:false,minify:false,sourcemap:false,rollupOptions:{external:id=>id.startsWith('node:')||builtinModules.includes(id),output:{format:'es',entryFileNames:'main.mjs',inlineDynamicImports:true,banner:'/*! WillYou Zentao plugin; includes Zod.\n'+license.replaceAll('*/','* /')+'\n*/'}}}});
  return destination;
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))await buildZentaoPlugin(process.argv[2]);
