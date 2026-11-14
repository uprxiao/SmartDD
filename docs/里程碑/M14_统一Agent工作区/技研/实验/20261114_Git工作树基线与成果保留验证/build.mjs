import { build } from '/private/tmp/willyou-m14-owner-probe/node_modules/esbuild/lib/main.js';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = '/Users/hx/projects/SmartDD';
const output = '/private/tmp/willyou-m14-git-probe';
const result = await build({
  stdin: {contents: `export {NativeFileBroker} from '${root}/src/main/core/files/native-broker.ts'; export {parseGitStatus} from '${root}/src/main/core/files/git-metadata.ts';`, resolveDir:root, loader:'ts'},
  outfile:join(output,'actual-files.cjs'), bundle:true, platform:'node', format:'cjs', metafile:true,
  alias:{'@shared':join(root,'src/shared')},
  nodePaths:['/private/tmp/willyou-m14-owner-probe/node_modules'],
});
const inputs = Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('<')).map(p=>join(process.cwd(),p));
function nativeFiles(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?nativeFiles(join(dir,e.name)):/\.(mm|h|hpp|cc|inc)$/.test(e.name)?[join(dir,e.name)]:[]);}
const files = [...new Set([...inputs,...nativeFiles(join(root,'native/files'))])];
writeFileSync(join(output,'build.json'),JSON.stringify({
  noSourceReplacement:true, testFailpoints:false,
  nativeCommand:'xcrun clang++ -std=c++17 -fobjc-arc -O1 -Wno-deprecated-declarations -framework Foundation -framework AppKit -framework ImageIO -framework CoreGraphics -framework CoreText native/files/broker.mm -o /private/tmp/willyou-m14-git-probe/file-broker',
  files:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')})),
},null,2)+'\n');
