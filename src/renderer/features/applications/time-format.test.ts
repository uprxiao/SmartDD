import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const localRequire=createRequire(import.meta.url),{buildSync}=createRequire(localRequire.resolve('vite/package.json'))('esbuild');
import {timeText} from './controls';
let root:string,compiled:string;
beforeAll(()=>{root=mkdtempSync(join(tmpdir(),'willyou-time-test-'));compiled=join(root,'controls.cjs');buildSync({entryPoints:[resolve('src/renderer/features/applications/controls.tsx')],outfile:compiled,tsconfig:resolve('tsconfig.web.json'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});});
afterAll(()=>{if(root)rmSync(root,{recursive:true,force:true})});
const inputs=['2026-01-01T00:05:59.987Z','2024-02-29T23:59:00Z','2026-03-08T06:59:00Z','2026-03-08T07:01:00Z','2026-11-01T05:30:00Z','2026-11-01T06:30:00Z','2026-01-01T08:05:59.987+08:00','2026-01-01T00:05:59.987654Z'];
const zones=[['UTC',['2026-01-01 00:05','2024-02-29 23:59','2026-03-08 06:59','2026-03-08 07:01','2026-11-01 05:30','2026-11-01 06:30','2026-01-01 00:05','2026-01-01 00:05']],['Asia/Singapore',['2026-01-01 08:05','2024-03-01 07:59','2026-03-08 14:59','2026-03-08 15:01','2026-11-01 13:30','2026-11-01 14:30','2026-01-01 08:05','2026-01-01 08:05']],['America/New_York',['2025-12-31 19:05','2024-02-29 18:59','2026-03-08 01:59','2026-03-08 03:01','2026-11-01 01:30','2026-11-01 01:30','2025-12-31 19:05','2025-12-31 19:05']]] as const;
describe('PK fixed application dates in the current local timezone',()=>{
 it('distinguishes missing audit timestamps from an unchecked connection',()=>{expect(timeText(null,'未记录')).toBe('未记录');expect(timeText('', '未记录')).toBe('未记录');expect(timeText('broken','未记录')).toBe('时间不可用');});
 it.each([null,undefined,''])('preserves the existing missing-check state for %s',value=>expect(timeText(value)).toBe('尚未检查'));
 it.each(['broken',' ','2026-02-30T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00','2026-01-01','2026-10-23 10:20','0'])('does not invent an audit time from %s',value=>expect(timeText(value)).toBe('时间不可用'));
 it.each(zones)('uses padded 24-hour local dates in %s across year/leap/daylight boundaries',(zone,expected)=>{const before=process.env.TZ;const text=execFileSync(process.execPath,['-e',`const {timeText}=require(${JSON.stringify(compiled)});process.stdout.write(JSON.stringify(${JSON.stringify(inputs)}.map(value=>timeText(value))))`],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TZ:zone},encoding:'utf8',timeout:15000});expect(JSON.parse(text)).toEqual(expected);expect(process.env.TZ).toBe(before);expect(inputs[0]).toBe('2026-01-01T00:05:59.987Z');});
});
