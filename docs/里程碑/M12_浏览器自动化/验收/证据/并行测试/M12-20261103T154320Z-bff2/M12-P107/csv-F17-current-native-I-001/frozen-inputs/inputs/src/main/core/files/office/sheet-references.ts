import { FileError } from '@shared/files';

export interface OfficeSheetReferenceChange { oldName:string; newName:string|null; sheets:readonly string[]; removedTables?:readonly string[] }
const folded=(value:string)=>value.toLocaleLowerCase('en-US');
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`;
const unsupported=():never=>{throw new FileError('UNSUPPORTED','此公式的跨表引用形式需要进一步适配，原件和草稿仍保留');};

/** Lexical range operands only. Unlike an engine formula round trip this keeps
 * strings, whitespace, structured selectors and untouched names verbatim.
 * Port of the reviewed predev-office-adapter token_rewrite contract; no eval. */
export function rewriteOfficeSheetReferences(source:string,change:OfficeSheetReferenceChange):string {
  if (source.length>8192) throw new FileError('TOO_LARGE','公式超过 8192 个字符');
  const old=folded(change.oldName),names=change.sheets.map(folded),removed=new Set((change.removedTables ?? []).map(folded));
  const quotedEnd=(text:string,start:number,delimiter:string)=>{
    let at=start+1;
    while(at<text.length) {if(text[at++] !== delimiter) continue;if(text[at] === delimiter){at++;continue;}return at;}
    throw new FileError('INVALID_INPUT','公式引号未闭合');
  };
  const marks=(text:string,symbol:string):number[]=>{
    const found:number[]=[];let depth=0;
    for(let at=0;at<text.length;at++) {
      const char=text[at];
      if(char === "'" && !depth){at=quotedEnd(text,at,"'")-1;continue;}
      if(char === '[') depth++;else if(char === ']'){if(!depth) unsupported();depth--;}
      else if(!depth && char === symbol) found.push(at);
    }
    if(depth) unsupported();return found;
  };
  const decode=(text:string)=>text.startsWith("'") && text.endsWith("'") ? text.slice(1,-1).replaceAll("''","'") : text;
  const operand=(text:string,bareTable=true):string=>{
    if(text.startsWith('@')){const updated=operand(text.slice(1),bareTable);return updated === '#REF!' ? updated : `@${updated}`;}
    if(bareTable && removed.has(folded(text)))return '#REF!';
    const bracket=text.indexOf('[');if(bracket>0 && removed.has(folded(text.slice(0,bracket)))) return '#REF!';
    const bangs=marks(text,'!');if(!bangs.length)return text;
    if(bangs.length>1) {
      // A1 ranges can qualify both endpoints. Handle exactly that grammar;
      // never mistake a quoted ! in a sheet name for a second reference.
      if(bangs.length !== 2) return unsupported();
      const separators=marks(text,':').filter(at=>at>bangs[0] && at<bangs[1]);
      if(separators.length !== 1)return unsupported();
      const left=operand(text.slice(0,separators[0])),right=operand(text.slice(separators[0]+1));
      return left === '#REF!' || right === '#REF!' ? '#REF!' : `${left}:${right}`;
    }
    const bang=bangs[0],head=text.slice(0,bang),tail=text.slice(bang+1);
    if(head.includes('[') || head.includes(']')) return text; // another workbook
    const colons=marks(head,':');
    const endpoints=colons.length === 1 ? [decode(head.slice(0,colons[0])),decode(head.slice(colons[0]+1))] : colons.length ? unsupported() : decode(head).split(':');
    if(endpoints.length>2 || !tail) return text;
    if(endpoints.length === 1) {
      if(folded(endpoints[0]) !== old)return text;
      return change.newName === null ? '#REF!' : `${quote(change.newName)}!${tail}`;
    }
    const first=names.indexOf(folded(endpoints[0])),last=names.indexOf(folded(endpoints[1]));
    if(first<0 || last<0) return unsupported();
    const from=Math.min(first,last),to=Math.max(first,last),oldIndex=names.indexOf(old);
    if(oldIndex<from || oldIndex>to)return text;
    let left=endpoints[0],right=endpoints[1];
    if(change.newName !== null) {
      if(folded(left) === old)left=change.newName;if(folded(right) === old)right=change.newName;
      if(left === endpoints[0] && right === endpoints[1])return text;
    } else {
      const remaining=change.sheets.slice(from,to+1).filter(name=>folded(name) !== old);
      if(!remaining.length)return '#REF!';
      left=first<=last ? remaining[0] : remaining.at(-1)!;right=first<=last ? remaining.at(-1)! : remaining[0];
      if(left === endpoints[0] && right === endpoints[1])return text;
    }
    return `${quote(left === right ? left : `${left}:${right}`)}!${tail}`;
  };
  let output='',at=0;
  while(at<source.length) {
    const start=at,char=source[at];
    if(char === '"'){at=quotedEnd(source,at,'"');output+=source.slice(start,at);continue;}
    if(/[\s+\-*/^&=<>%,;(){}]/u.test(char)){output+=char;at++;continue;}
    let depth=0;
    while(at<source.length) {
      const current=source[at];
      if(current === "'" && !depth){at=quotedEnd(source,at,"'");continue;}
      if(current === '[')depth++;else if(current === ']'){if(!depth)unsupported();depth--;}
      if(!depth && /[\s+\-*/^&=<>%,;(){}]/u.test(current))break;
      at++;
    }
    if(depth)unsupported();
    output+=operand(source.slice(start,at),source[at] !== '(');
  }
  return output;
}
