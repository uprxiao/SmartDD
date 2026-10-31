// Standalone prerequisite helpers need the same checked-in raw assets that Vite
// normally supplies. This loader applies only to the helper, never the App.
// Reuses the original session-ui.mjs raw-asset setup and its explicit patterns.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function compileApplicationFixture({entry,output,includeMigrations=false}){
 const source=resolve(entry),target=resolve(output),allowed=resolve('scripts/applications/fixtures')+sep;
 assert(source.startsWith(allowed)&&source.endsWith('.ts'),'Compile a known application prerequisite only');assert(target.startsWith('/private/tmp/willyou-m10-')&&target.endsWith('.cjs'),'Use this acceptance temporary root only');
 await mkdir(dirname(target),{recursive:true});const files={};
 async function collect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())await collect(path);else if(item.isFile())files['/'+path.replaceAll('\\','/')]=await readFile(path,'utf8');else throw Error('Unexpected raw-asset source link');}}
 await collect('resources/standard-skills');await collect('resources/runtime');await collect('resources/agent-adapters');
 const maps={'@root/resources/standard-skills/**':Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('/resources/standard-skills/'))),'@root/resources/runtime/*.py':Object.fromEntries(Object.entries(files).filter(([name])=>/^\/resources\/runtime\/[^/]+\.py$/.test(name))),'@root/resources/agent-adapters/**/*':Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('/resources/agent-adapters/')))};
 if(includeMigrations){assert(source.endsWith('/startup-run-seed.ts'),'Migration assets are only for the explicit startup history fixture');const sql={};for(const item of await readdir('drizzle',{withFileTypes:true})){if(item.isFile()&&item.name.endsWith('.sql'))sql['/drizzle/'+item.name]=await readFile(join('drizzle',item.name),'utf8');}maps['@root/drizzle/*.sql']=sql;}
 const shim=join(dirname(target),'raw-assets.mjs');await writeFile(shim,'const maps='+JSON.stringify(maps)+';export function m10FixtureGlob(pattern){if(!Object.hasOwn(maps,pattern))throw new Error("Unexpected prerequisite glob");return maps[pattern];}\n');
 const require=createRequire(import.meta.url),esbuildRequire=createRequire(require.resolve('vite/package.json')),cli=resolve(dirname(esbuildRequire.resolve('esbuild')),'../bin/esbuild');
 execFileSync(cli,[source,'--bundle','--inject:'+shim,'--define:import.meta.glob=m10FixtureGlob','--external:better-sqlite3','--platform=node','--target=node22','--format=cjs','--alias:@shared='+resolve('src/shared'),...(includeMigrations?['--alias:@root='+resolve('.')]:[]),'--define:import.meta.url='+JSON.stringify(pathToFileURL(target).href),'--outfile='+target],{stdio:'pipe',timeout:20000});
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');return{entry:source,output:target,compiledSha256:sha(await readFile(target)),rawAssetsSha256:sha(JSON.stringify(maps)),scope:'Only standalone prerequisite helper; original checked-in raw text; App/runtime untouched'};
}
