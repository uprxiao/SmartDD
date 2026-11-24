import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(join(repo,'package.json'));
const build = createRequire(require.resolve('electron-vite'))('esbuild').build;
const [ref = '60e7f65452e96f2f76c9fa82725f972822d2091a', helperArg] = process.argv.slice(2);
assert.match(ref,/^[a-f0-9]{40}$/);
assert(helperArg, 'Use the pinned arm64 browser helper from the packaged application');
const helper = resolve(helperArg);
assert.match(helper,/^\/private\/tmp\/willyou-.*\/WillYou\.app\/Contents\/Resources\/agent-browser\/arm64\/agent-browser$/);
const root = await mkdtemp('/private/tmp/willyou-m15-login-');
console.log('M15_LOGIN_ROOT=' + root);
const frozen = join(root,'source');
for (const path of [frozen,join(root,'data'),join(root,'home'),join(root,'scratch')]) await mkdir(path,{mode:0o700});
const snapshot = join(root,'source.tar');
execFileSync('git',['archive','--format=tar','--output='+snapshot,ref,'src','drizzle'],{cwd:repo});
execFileSync('/usr/bin/tar',['-xf',snapshot,'-C',frozen]);
const files = await readdir(join(frozen,'drizzle'));
const migrations = Object.fromEntries(await Promise.all(files.filter(file=>file.endsWith('.sql')).map(async file=>[
  '@root/drizzle/' + file, await readFile(join(frozen,'drizzle',file),'utf8'),
])));
const glob = /import\.meta\.glob\('@root\/drizzle\/\*\.sql', \{[\s\S]*?\}\)/;
const entry = join(root,'login-study.cjs');
await build({
  absWorkingDir:repo, bundle:true, platform:'node', target:'node22', format:'cjs',
  entryPoints:[fileURLToPath(new URL('./login-study.ts',import.meta.url))], outfile:entry,
  alias:{'@study':join(frozen,'src'),'@shared':join(frozen,'src/shared'),'@root':frozen}, nodePaths:[join(repo,'node_modules')],
  external:['electron'], plugins:[{name:'frozen-sql-migration-glob',setup(builder){
    builder.onLoad({filter:/\/db\/migrations\.ts$/},async args=>{
      assert.equal(args.path,join(frozen,'src/main/db/migrations.ts'));
      const source = await readFile(args.path,'utf8');
      assert(glob.test(source));
      return {contents:source.replace(glob,()=>JSON.stringify(migrations)),loader:'ts',resolveDir:join(frozen,'src/main/db')};
    });
  }}],
});
execFileSync(process.execPath,['--check',entry]);
const checksum = file => readFile(file).then(bytes=>createHash('sha256').update(bytes).digest('hex'));
const helperHash = await checksum(helper);
const child = spawn(require('electron'),[entry,'--user-data-dir='+join(root,'data')],{
  cwd:root, env:{PATH:'/usr/bin:/bin',HOME:join(root,'home'),TMPDIR:join(root,'scratch'),
    WY_M15_LOGIN_ROOT:root,WY_M15_LOGIN_COMMIT:ref,WY_M15_LOGIN_SQLITE:require.resolve('better-sqlite3'),
    WY_M15_LOGIN_HELPER:helper,WY_M15_LOGIN_HELPER_HASH:helperHash,
  },
  stdio:['ignore','inherit','inherit'],
});
const timer = setTimeout(()=>{child.kill('SIGTERM');console.error('Isolated login study exceeded its deadline');},55000);
try {
  const code = await new Promise((ok,fail)=>{
    child.once('error',fail);
    child.once('exit',(code,signal)=>{if(signal)console.error('Own Electron exit '+signal);ok(code??1);});
  });
  console.log(JSON.stringify({code,sourceArchiveSha256:await checksum(snapshot),helperSha256:helperHash,root}));
  if(code!==0) {
    try { console.error(JSON.parse(await readFile(join(root,'result.json'),'utf8')).error); } catch {}
  }
  process.exitCode = code;
} finally { clearTimeout(timer); }
