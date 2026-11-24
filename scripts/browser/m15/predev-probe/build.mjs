import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo = process.argv[2];
const lab = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(join(repo,'package.json'));
const esbuild = require(join(repo,'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
await esbuild.build({absWorkingDir:lab, entryPoints:['probe.ts'], outfile:'probe.cjs', bundle:true, platform:'node', target:'es2022', format:'cjs', external:['electron'], nodePaths:[join(repo,'node_modules')], alias:{'@source':join(lab,'frozen/src'),'@shared':join(lab,'frozen/src/shared')}, logLevel:'warning', plugins:[{name:'outer-async',setup(build){build.onLoad({filter:/probe\.ts$/},async args=>{const {readFile}=await import('node:fs/promises');const source=await readFile(args.path,'utf8');const marker='const root =';const offset=source.indexOf(marker);return {contents:source.slice(0,offset)+'void (async () => {\n'+source.slice(offset)+'\n})();\n',loader:'ts',resolveDir:lab};});}}]});
