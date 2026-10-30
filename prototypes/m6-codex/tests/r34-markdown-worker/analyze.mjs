import { parseMarkdown, renderMarkdownBlock, highlightedCode, codeBody, parseFrontmatter } from '../../src/file-markdown-model.mjs';
const types = ['blank','definition','frontmatter','heading','paragraph','quote','list','table','rule','math','mermaid','code','image'];
export function analyze(source) {
  const parsed = parseMarkdown(source), index = new Uint32Array(parsed.blocks.length * 4);
  let cursor = 0;
  for (let i=0;i<parsed.blocks.length;i++) {
    const b=parsed.blocks[i];
    if (b.from!==cursor || source.slice(b.from,b.to)!==b.raw) throw new Error('source-range mismatch');
    index.set([b.from,b.to,b.line,types.indexOf(b.type)],i*4);cursor=b.to;
  }
  if(cursor!==source.length) throw new Error('source coverage mismatch');
  return {parsed,index};
}
export function renderWindow(parsed,start,count) {
  if(count>60) throw new Error('render window limit');
  return parsed.blocks.slice(start,start+count).map(b=>({from:b.from,to:b.to,type:b.type,
    ...(b.type==='frontmatter'?{metadata:parseFrontmatter(b.raw)}:b.type==='mermaid'?{source:codeBody(b)}:b.type==='code'?{html:highlightedCode(b).html}:b.tokens?{html:renderMarkdownBlock(b,parsed.env)}:{source:b.raw})}));
}
export async function digest(value) {
  const data=value instanceof Uint32Array?new Uint8Array(value.buffer):new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
