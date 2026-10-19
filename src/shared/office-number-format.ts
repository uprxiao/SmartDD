import { get_table } from 'ssf';
export function officeNumberFormat(value:string|number) {
  const code=typeof value === 'number' ? get_table()[value] ?? '' : value;
  if(code.toLowerCase()==='general')return {kind:'general' as const,decimals:2,code};
  const match=/^("¥")?(?:#,##)?0(?:\.(0{1,6}))?(%)?$/.exec(code);
  if(!match || match[1] && match[3])return {kind:'custom' as const,decimals:0,code};
  return {kind:match[3] ? 'percent' as const : match[1] ? 'currency' as const : 'number' as const,decimals:match[2]?.length ?? 0,code};
}
