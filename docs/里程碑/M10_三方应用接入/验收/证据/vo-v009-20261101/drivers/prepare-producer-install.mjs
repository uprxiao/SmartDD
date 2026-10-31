// Reuse the real producer DMG, rather than compressing a second image for UI.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {installationTree} from './dmg-install-ui.mjs';
const[sourceArgument,dmgArgument,pin]=process.argv.slice(2),sourceApp=resolve(sourceArgument),sourceDmg=resolve(dmgArgument);
assert(sourceApp.startsWith('/private/tmp/willyou-m10-')&&sourceApp.endsWith('/WillYou.app'));assert.equal(basename(sourceDmg),'WillYou-0.0.9-mac-arm64.dmg');
const sha=b=>createHash('sha256').update(b).digest('hex'),sourceAsarSha256=sha(await readFile(join(sourceApp,'Contents/Resources/app.asar')));assert.equal(sourceAsarSha256,pin);
const root=await mkdtemp('/private/tmp/willyou-m10-vf-install-');await mkdir(join(root,'dmg'));const dmg=join(root,'dmg',basename(sourceDmg));await copyFile(sourceDmg,dmg,constants.COPYFILE_FICLONE);assert.equal(sha(await readFile(dmg)),sha(await readFile(sourceDmg)));
const tree=await installationTree(sourceApp);await writeFile(join(root,'source-bundle-tree.json'),JSON.stringify(tree,null,2)+'\n');
const inputs={schema:'m10-v009-producer-install-inputs-v1',root,sourceApp,sourceAsarSha256,sourceDmg,dmg,dmgSha256:sha(await readFile(dmg)),startedAt:new Date().toISOString(),status:'prepared-original-producer-dmg',boundary:'Own temporary Applications and exact original producer package;no global install,trust or quarantine changes'};await writeFile(join(root,'inputs.json'),JSON.stringify(inputs,null,2)+'\n');console.log(JSON.stringify(inputs));
