export const FILE_INLINE_DIFF_LIMITS=Object.freeze({units:262144,lines:5000});
function tooManyLines(text){let lines=1;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);if(code===13){if(text.charCodeAt(i+1)===10)i++;lines++;}else if(code===10)lines++;if(lines>FILE_INLINE_DIFF_LIMITS.lines)return true;}return false;}
/** Eligibility uses raw UTF16, before CodeMirror normalizes CRLF/CR. It never
 * chooses a version or changes the separate load/edit/save byte limits. */
export function fileInlineDiffPolicy(disk,local){
 if(disk===null)return{state:'none',reason:''};
 if(disk.length>FILE_INLINE_DIFF_LIMITS.units||local.length>FILE_INLINE_DIFF_LIMITS.units)return{state:'too-large',reason:'其中一个版本超过 262144 UTF-16 字符，已暂停差异绘制；两份源码和版本操作仍保留。'};
 if(tooManyLines(disk)||tooManyLines(local))return{state:'too-large',reason:'其中一个版本超过 5000 行，已暂停差异绘制；两份源码和版本操作仍保留。'};
 return{state:'enabled',reason:''};
}
