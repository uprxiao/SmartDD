import {formatBoundaryFixtures} from './format-boundary-fixtures.mjs';
import {writeFile} from 'node:fs/promises';
const root=new URL('../format/',import.meta.url), f=formatBoundaryFixtures();
for(const [name,bytes] of Object.entries(f.files)) await writeFile(new URL('project/'+name,root),bytes);
await writeFile(new URL('fixtures.json',root),JSON.stringify({cases:f.cases},null,2)+'\n');
console.log(JSON.stringify({generatedFiles:Object.keys(f.files).length,originalCases:f.cases.length}));
