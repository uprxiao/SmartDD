// Prepare an isolated installation image from an already verified App.
// This does not rebuild, publish, install globally, or change application data.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {installationTree} from './fixtures/dmg-install-ui.mjs';
const sourceApp=resolve(process.env.WILLYOU_DMG_SOURCE_APP??'');
assert(sourceApp.startsWith('/private/tmp/willyou-m10-')&&sourceApp.endsWith('/WillYou.app'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceAsarSha256=sha(await readFile(join(sourceApp,'Contents/Resources/app.asar')));
assert.equal(sourceAsarSha256,process.env.WILLYOU_ACCEPTANCE_ASAR_SHA);
const root=await mkdtemp('/private/tmp/willyou-m10-vf-install-');
const result={schema:'m10-current-dmg-prepare-v1',root,sourceApp,sourceAsarSha256,startedAt:new Date().toISOString(),status:'running'};
await writeFile(join(root,'inputs.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
try{
 const tree=await installationTree(sourceApp);
 await writeFile(join(root,'source-bundle-tree.json'),JSON.stringify(tree,null,2)+'\n');
 await mkdir(join(root,'stage'));await mkdir(join(root,'dmg'));
 execFileSync('/usr/bin/ditto',[sourceApp,join(root,'stage/WillYou.app')],{timeout:180000});
 assert.deepEqual(await installationTree(join(root,'stage/WillYou.app')),tree);
 await symlink('/Applications',join(root,'stage/Applications'));
 const dmg=join(root,'dmg/WillYou-0.0.5-mac-arm64.dmg');
 result.hdiutil=execFileSync('/usr/bin/hdiutil',['create','-volname','WillYou','-format','UDZO','-srcfolder',join(root,'stage'),dmg],{encoding:'utf8',timeout:300000}).trim();
 result.dmg=dmg;result.dmgSha256=sha(await readFile(dmg));result.bundleEntries=Object.keys(tree).length;
 assert.deepEqual(await installationTree(sourceApp),tree);result.sourceUnchanged=true;result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{result.finishedAt=new Date().toISOString();await writeFile(join(root,'prepare-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
