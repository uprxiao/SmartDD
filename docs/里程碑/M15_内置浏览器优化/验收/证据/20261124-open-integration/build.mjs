import {writeFile,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const cwd=process.cwd();
const require=createRequire(join(cwd,'package.json'));
const {build}=require(join(cwd,'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
const lab=dirname(fileURLToPath(import.meta.url));
const file=join(lab,'main.ts');
const source=await readFile(file,'utf8');
const offset=source.indexOf('const root=');
if(offset<0)throw Error('fixture missing entry');
await build({
  absWorkingDir:cwd,bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','better-sqlite3'],
  stdin:{contents:source.slice(0,offset)+'void (async () => {\n'+source.slice(offset)+'\n})();\n',loader:'ts',resolveDir:cwd},
  outfile:join(lab,'main.cjs'),alias:{'@root':cwd,'@main':join(cwd,'src/main'),'@shared':join(cwd,'src/shared')},logLevel:'warning',
});
await writeFile(join(lab,'bootstrap.cjs'),`
const fs=require('node:fs');
const {app}=require('electron');
function fail(error){
  fs.writeFileSync(require('node:path').join(__dirname,'startup-error.txt'),String(error.stack??error));
  app.exit(1);
}
process.on('uncaughtException',fail);
process.on('unhandledRejection',fail);
try {require.resolve('better-sqlite3');require('./main.cjs');}catch(error){fail(error);}
`);
