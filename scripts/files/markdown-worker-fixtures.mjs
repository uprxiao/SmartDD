// Reuse the reviewed deterministic R3.4 semantic source, not a new easy corpus.
import {fixtureOfSize,semanticFixture} from '../../prototypes/m6-codex/tests/r34-markdown-worker/fixtures.mjs';
export const markdownWorkerSampleSizes=[100*1024,256*1024,1024*1024,2*1024*1024,10*1024*1024];
export const markdownWorkerSample=bytes=>fixtureOfSize(bytes);
export const markdownSemanticFixture=semanticFixture;
export function malformedMarkdownFixtures(){return[
 {name:'nul',source:'# NUL raw\r\na\u0000b 中文🙂\r\n',encoding:'utf8'},
 {name:'lone-surrogate',source:'## Isolated code units\nx\ud800y\nlow\udfffend\n',encoding:'utf16le'},
 {name:'deep-quote',source:'>'.repeat(5000)+' x 中文🙂\n',encoding:'utf8'},
 {name:'deep-list',source:Array.from({length:500},(_,i)=>' '.repeat(i*2)+'- x').join('\n')+'\n',encoding:'utf8'},
 {name:'long-line',source:'a'.repeat(2_000_000)+'\n',encoding:'utf8'},
 {name:'unclosed-fence',source:'```js\r\n'+'const x=1;\r\n'.repeat(1000),encoding:'utf8'},
 {name:'wide-table',source:'|'+'a|'.repeat(2000)+'\n|'+'-|'.repeat(2000)+'\n',encoding:'utf8'},
 {name:'deep-emphasis',source:'*'.repeat(50000)+'a'+'*'.repeat(50000),encoding:'utf8'},
];}
