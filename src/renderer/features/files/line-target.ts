export type LineTarget = { valid:true; line:number; requested:number; clamped:boolean } | { valid:false; error:string };
export const STALE_LINE_PREVIEW='文件或光标已变化，请重新打开跳行';
/** Approved whole-line syntax; negative integers count from the final line. */
export function resolveLineTarget(value:string,lineCount:number):LineTarget{
 const text=value.trim();if(!/^-?\d+$/.test(text))return{valid:false,error:'请输入非零的整数行号'};
 const requested=Number(text);if(!Number.isSafeInteger(requested))return{valid:false,error:'行号超出安全整数范围'};
 if(requested===0)return{valid:false,error:'请输入非零的整数行号'};
 const count=Number.isSafeInteger(lineCount)&&lineCount>0?lineCount:1,target=requested<0?count+requested+1:requested,line=Math.max(1,Math.min(count,target));
 return{valid:true,line,requested,clamped:line!==target};
}
