import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, renderMarkdownBlock, highlightedCode, markdownTextareaEdit, completeFence } from '../src/file-markdown-model.mjs';
import { lineSourceMap, sourcePoint, sourceRange } from '../src/file-markdown-source.mjs';
const children=text=>parseMarkdown(text).blocks.flatMap(block=>block.tokens||[]).flatMap(token=>token.children||[]);
test('inline consumption maps repeated text, emphasis, emoji, escapes and entities to original source',()=>{
 const text='# same **same** 😀 &amp; \\*same*\r\n';
 const tokens=children(text), mapped=tokens.filter(t=>t.content&&t.meta?.source);
 for(const token of mapped.filter(t=>t.meta.source.mode==='linear'))assert.equal(text.slice(token.meta.source.from,token.meta.source.to),token.content);
 assert.equal(tokens.find(t=>t.content==='same'&&t.meta.source.from===9).meta.source.to,13);
 const entity=tokens.find(t=>t.content==='&');assert.equal(text.slice(entity.meta.source.from,entity.meta.source.to),'&amp;');assert.equal(entity.meta.source.mode,'atomic');
 const escaped=tokens.find(t=>t.content==='*'&&t.info==='escape');assert.equal(text.slice(escaped.meta.source.from,escaped.meta.source.to),'\\*');
});
test('two identical formulas retain distinct source ranges rather than searching rendered math',()=>{
 const text='😀 $x^2$ and $x^2$';const formulas=children(text).filter(t=>t.type==='math_inline');
 assert.deepEqual(formulas.map(t=>[t.meta.source.from,t.meta.source.to]),[[3,8],[13,18]]);
 for(const token of formulas)assert.equal(text.slice(token.meta.source.from,token.meta.source.to),'$x^2$');
});
test('CRLF quotes and nested list task markers keep source line and character offsets',()=>{
 const text='> 中文\r\n> second\r\n\r\n- [ ] one\r\n  - [x] two\r\n';const parsed=parseMarkdown(text);
 parsed.blocks.filter(b=>b.tokens).forEach(b=>renderMarkdownBlock(b,parsed.env));
 for(const token of parsed.blocks.flatMap(b=>b.tokens||[]).flatMap(t=>t.children||[]).filter(t=>t.meta?.source?.mode==='linear'&&t.content))assert.equal(text.slice(token.meta.source.from,token.meta.source.to),token.content);
 assert.equal(children(text).find(t=>t.content==='two').meta.source.from,text.indexOf('two'));
});
test('table cells cannot borrow a repeated word from an earlier escaped-pipe cell',()=>{
 const text='| a\\|same | same |\n|---|---|\n| same | same |\n';
 const inlines=parseMarkdown(text).blocks[0].tokens.filter(t=>t.type==='inline');
 assert.equal(inlines[0].children[0].meta.source,undefined);
 assert.equal(inlines[1].children[0].meta.source.from,12);
 assert.equal(inlines[2].children[0].meta.source.from,text.indexOf('| same | same |')+2);
 assert.equal(inlines[3].children[0].meta.source.from,text.indexOf('| same | same |')+9);
});
test('ambiguous or normalized source projection is explicit rather than a guessed offset',()=>{
 assert.equal(lineSourceMap('> >\n','>'),null);
 assert.equal(lineSourceMap('\ttext\n','    text'),null);
 assert.deepEqual(sourcePoint({from:4,to:20,mode:'atomic',renderedOffset:2},'start'),{offset:4,exact:false});
 assert.deepEqual(sourcePoint({from:4,to:20,mode:'atomic',renderedOffset:2},'end'),{offset:20,exact:false});
 assert.equal(sourceRange({offset:7,exact:true},{offset:3,exact:true},20),null);
});
test('cross-block endpoint range includes source markup and validates document bounds',()=>{
 const text='one **two**\r\n\r\nthree 😀 four';
 const start=sourcePoint({from:0,to:4,mode:'linear',renderedOffset:2});const end=sourcePoint({from:15,to:text.length,mode:'linear',renderedOffset:8},'end');
 const range=sourceRange(start,end,text.length);assert.equal(text.slice(range.from,range.to),'e **two**\r\n\r\nthree 😀');assert.equal(range.exact,true);
 assert.equal(sourceRange(start,{offset:99,exact:true},text.length),null);
});
test('highlighted fences use existing language aliases and escape unknown code safely',()=>{
 const code=parseMarkdown('```ts\r\nconst 名 = "<script>";\r\n```\r\n').blocks[0], out=highlightedCode(code);
 assert.equal(out.language,'typescript');assert.match(out.html,/hljs-keyword/);assert.ok(!out.html.includes('<script>'));
 const at=out.code.indexOf('名');assert.deepEqual(sourcePoint({from:code.from,to:code.to,mode:'atomic',renderedOffset:at,runs:out.map.runs}),{offset:code.raw.indexOf('名'),exact:true});
 const unknown=highlightedCode(parseMarkdown('```unknown\n<img src=x onerror=bad>\n```').blocks[0]);assert.equal(unknown.language,null);assert.match(unknown.html,/&lt;img/);
});
test('only a complete lowercase mermaid fence becomes a diagram',()=>{
 assert.equal(parseMarkdown('```mermaid\nA-->B\n').blocks[0].type,'code');
 assert.equal(parseMarkdown('```Mermaid\nA-->B\n```').blocks[0].type,'code');
 assert.equal(parseMarkdown('~~~mermaid\nA-->B\n~~~~\n').blocks[0].type,'mermaid');
 assert.equal(completeFence('```mermaid\nA-->B\n``'),false);
});
test('textarea edits preserve untouched mixed line endings and adopt local EOL for inserted lines',()=>{
 const text='a\r\nb\nc\rd 😀';assert.equal(markdownTextareaEdit(text,'a\nB\nc\nd 😀'),'a\r\nB\nc\rd 😀');
 assert.equal(markdownTextareaEdit('one\r\ntwo\r\n','one\nnew\ntwo\n'),'one\r\nnew\r\ntwo\r\n');
 assert.equal(markdownTextareaEdit('same\r\n','same\n'),'same\r\n');
 assert.equal(markdownTextareaEdit('😀a\r\nb','😀a\nb!'),'😀a\r\nb!');
});
test('a large single inline token keeps source positions without argument-list overflow',()=>{
 const text='中文😀'.repeat(50000),tokens=children(text);
 assert.equal(tokens[0].content,text);
 assert.deepEqual(tokens[0].meta.source,{from:0,to:text.length,mode:'linear'});
});
