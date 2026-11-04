import {it,expect,afterAll} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {normalizeBrowserNavigationUrl} from './source/browser-navigation';
import {normalizeBrowserNavigationUrl as orca} from './reference/orca-browser-url';
const root='/private/tmp/willyou-m12-t005-url-u-001';const rows=JSON.parse(readFileSync(root+'/cases.json','utf8'));const observations:unknown[]=[];
it.each(rows)('M12-T005 $id $input',row=>{const actual=normalizeBrowserNavigationUrl(row.input,row.engine);const reference=orca(row.input,row.engine);observations.push({...row,actual,reference});expect(actual).toBe(row.expected);if(row.id.startsWith('P')||row.id.startsWith('Q'))expect(reference).toBe(row.expected);});
afterAll(()=>writeFileSync(root+'/observations.raw.json',JSON.stringify(observations,null,2)+'\n'));
