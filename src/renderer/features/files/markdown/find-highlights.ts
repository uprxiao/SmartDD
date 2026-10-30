import{findText,type TextMatch}from'../text-find';
import{domSourcePoint}from'./file-markdown-source.mjs';

export interface RenderedFileFind {query:string;matches:TextMatch[];current:number}
/** Unmatched images/diagrams keep their original widgets and resources. */
export function markdownFindKey(from:number,to:number,find?:RenderedFileFind):string{
 if(!find?.query)return'';
 const matches=find.matches.filter(match=>match.from<to&&match.to>from);if(!matches.length)return'';
 const current=find.matches[find.current];return JSON.stringify([find.query,matches,matches.includes(current)?current:null]);
}

/** Paint only exact source-mapped members of the same bounded Find result.
 * No DOM text is deserialized into the editor or used to guess source offsets. */
export function paintMarkdownFind(element:HTMLElement,find:RenderedFileFind,toEditorOffset:(raw:number)=>number):void{
 if(!find.query||!find.matches.length)return;
 const members=new Map(find.matches.map((match,index)=>[`${match.from}:${match.to}`,index]));
 const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('.katex,math,svg,script,style')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
 const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
 for(const node of nodes){
  const text=node.data,spans:{from:number;to:number;sourceFrom:number;sourceTo:number;index:number}[]=[];
  for(const match of findText(text,find.query,1000)){
   const from=domSourcePoint(element,node,match.from,'start'),to=domSourcePoint(element,node,match.to,'end');if(!from?.exact||!to?.exact)continue;
   const sourceFrom=toEditorOffset(from.offset),sourceTo=toEditorOffset(to.offset),index=members.get(`${sourceFrom}:${sourceTo}`);if(index===undefined)continue;
   spans.push({...match,sourceFrom,sourceTo,index});
  }
  if(!spans.length)continue;const fragment=document.createDocumentFragment();let offset=0;
  for(const span of spans){fragment.append(text.slice(offset,span.from));const mark=document.createElement('mark');mark.className='fw-find-match'+(span.index===find.current?' fw-find-current':'');mark.dataset.findFrom=String(span.sourceFrom);mark.dataset.findTo=String(span.sourceTo);mark.textContent=text.slice(span.from,span.to);fragment.append(mark);offset=span.to}
  fragment.append(text.slice(offset));node.replaceWith(fragment);
 }
}
