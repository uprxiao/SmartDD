import {describe,it,expect} from 'vitest';
import {ApplicationError} from '@shared/applications';
import {retryAfterDelay,retainRetryAfter,retryAfterWait} from '../retry-after';
const now=Date.UTC(1994,10,6,8,49,36);
describe('server Retry-After inside the host operation budget',()=>{
 it.each([
  ['3',3000],[' 0\t',0],['Sun, 06 Nov 1994 08:49:37 GMT',1000],
  ['Sunday, 06-Nov-94 08:49:37 GMT',1000],['Sun Nov  6 08:49:37 1994',1000],
 ] as const)('interprets %s as the minimum server delay in milliseconds', (raw,ms)=>{expect(retryAfterDelay(raw,now)).toBe(ms);});
 it.each([undefined,'','-1','1.5','0x10','Infinity','1, 2','1994-11-06T08:49:37Z'])('ignores malformed or non-HTTP Retry-After %s',raw=>{expect(retryAfterDelay(raw,now)).toBeNull();});
 it('keeps an overflowing nonnegative server delay beyond every bounded operation without overflowing a timer',()=>{const wait=retryAfterDelay('9'.repeat(300),now)!;expect(Number.isSafeInteger(wait)).toBe(true);expect(wait).toBeGreaterThan(120000);expect(wait).toBeLessThanOrEqual(2147483647);});
 it('does not delay because of an already elapsed HTTP date',()=>{expect(retryAfterDelay('Sun, 06 Nov 1994 08:49:35 GMT',now)).toBe(0);});
 it('interprets a two-digit obsolete year against the receiving century before applying its future limit',()=>{expect(retryAfterDelay('Wednesday, 01-Jan-70 00:00:00 GMT',Date.UTC(2026,9,27))).toBeGreaterThan(120000);});
 it('applies the obsolete-date fifty-year boundary to the full date,not only the year number',()=>{expect(retryAfterDelay('Wednesday, 01-Dec-76 00:00:00 GMT',Date.UTC(2026,0,1))).toBe(0);});
 it('retains only a host-private monotonic hint on the same original error without serializing raw headers',()=>{
  const error=retainRetryAfter(new ApplicationError('TRANSIENT_FAILURE','controlled temporary failure'),'31');expect(retryAfterWait(error)).toBeGreaterThan(30000);expect(retryAfterWait(error)).toBeLessThanOrEqual(31000);expect(retryAfterWait(new ApplicationError('TRANSIENT_FAILURE','same code is not the same error'))).toBe(0);expect(JSON.stringify(error)).not.toContain('31');
 });
});
