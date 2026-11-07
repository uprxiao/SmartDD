// Judge only: never transforms, strips, or substitutes the actual UI text.
import assert from'node:assert/strict';
export function assertReadableImportFailureAlert(text){
 assert.equal(typeof text,'string');assert(text.trim().length>0,'Visible business error must be nonempty');
 assert(!/Error\s+invoking\s+remote\s+method/i.test(text),'IPC invocation wrapper must not be visible');
 assert(!/browser[.:]importCookies\b/i.test(text),'Internal import method must not be visible');
 assert(!/^\s*Error\s*:/i.test(text),'Error: prefix must not be visible');
 return true;
}
