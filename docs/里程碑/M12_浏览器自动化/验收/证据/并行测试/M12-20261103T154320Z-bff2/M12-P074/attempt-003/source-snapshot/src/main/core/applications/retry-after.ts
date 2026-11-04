import {ApplicationError} from '@shared/applications';

// All owning operations are bounded to at most120s. Clamp larger server hints
// well beyond that bound without overflowing a number or creating a timer.
const maxWait=2_147_483_647;
const shortDay='(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)',month='(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const modern=new RegExp('^'+shortDay+', [0-9]{2} '+month+' [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$');
const oldDate=new RegExp('^((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)), ([0-9]{2}-'+month+'-)([0-9]{2})( [0-9]{2}:[0-9]{2}:[0-9]{2} GMT)$');
const ascii=new RegExp('^'+shortDay+' '+month+' (?: [0-9]|[0-9]{2}) [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$');
/** RFC9110 §10.2.3: a nonnegative integer delay or an HTTP-date, not an
 * arbitrary Date.parse input such as a bare negative/decimal number. */
export function retryAfterDelay(raw:string|undefined,now=Date.now()):number|null{
 if(raw===undefined)return null;const value=raw.trim();
 if(/^[0-9]+$/.test(value))return Math.min(Number(value)*1000,maxWait);
 let normalized=value;
 const old=oldDate.exec(value);
 if(old){const currentYear=new Date(now).getUTCFullYear(),year=Math.floor(currentYear/100)*100+Number(old[3]),limit=new Date(now);limit.setUTCFullYear(currentYear+50);normalized=old[1]+', '+old[2]+year+old[4];if(Date.parse(normalized)>limit.getTime())normalized=old[1]+', '+old[2]+(year-100)+old[4];}
 else if(ascii.test(value))normalized=value+' GMT';
 else if(!modern.test(value))return null;
 const date=Date.parse(normalized);return Number.isFinite(date)?Math.min(Math.max(0,date-now),maxWait):null;
}
// A host-only hint survives the original error through the pure package
// dispatcher. Raw headers do not enter shared error types, IPC or the ledger.
const notBefore=new WeakMap<ApplicationError,number>();
export function retainRetryAfter(error:ApplicationError,raw:string|undefined):ApplicationError{
 const wait=retryAfterDelay(raw);if(wait!==null)notBefore.set(error,performance.now()+wait);return error;
}
export function retryAfterWait(error:ApplicationError):number{
 const until=notBefore.get(error);return until===undefined?0:Math.max(0,Math.ceil(until-performance.now()));
}
