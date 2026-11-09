import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {csvAcceptanceFixtures} from './inputs/scripts/files/csv-acceptance-fixtures.mjs';
const root=fileURLToPath(new URL('./fixture/',import.meta.url));
const oracle=csvAcceptanceFixtures();await mkdir(root+'project',{recursive:true});
for(const item of oracle.cases)await writeFile(root+'project/'+item.name,item.source);
await writeFile(root+'fixtures.json',JSON.stringify(oracle,null,2)+'\n');
console.log(JSON.stringify({fixtureCases:oracle.cases.map(x=>x.name),nativeExecuted:false}));
