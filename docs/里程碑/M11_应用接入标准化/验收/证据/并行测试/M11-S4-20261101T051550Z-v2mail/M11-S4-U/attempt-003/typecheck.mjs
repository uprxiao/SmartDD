import {spawnSync} from 'node:child_process';
const tsc='/private/tmp/willyou-m11-s4/source-attempt-003/node_modules/typescript/bin/tsc';
for (const config of ['tsconfig.node.json','tsconfig.web.json']) {
  process.stdout.write('TYPECHECK '+config+'\n');
  const result=spawnSync(process.execPath,[tsc,'--noEmit','-p',config],{stdio:'inherit',env:process.env});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
