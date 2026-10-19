import{describe,expect,it}from'vitest';
import{resolveLineTarget}from'./line-target';
describe('approved whole-line targets',()=>{
 it.each([[1,1],[20,20],[21,20],[-1,20],[-20,1],[-21,1]])('20lines request%i resolves to%i',(requested,line)=>{expect(resolveLineTarget(String(requested),20)).toMatchObject({valid:true,line,requested})});
 it('empty text has one logical line',()=>{expect(resolveLineTarget('1',1)).toMatchObject({valid:true,line:1});expect(resolveLineTarget('-1',1)).toMatchObject({valid:true,line:1})});
 it.each(['0','-0','1.5','abc','9007199254740992',' ','','+1','1e3','1:2','Infinity'])('rejects %j as a whole safe nonzero line',value=>{expect(resolveLineTarget(value,20)).toMatchObject({valid:false});const result=resolveLineTarget(value,20);if(!result.valid)expect(result.error).toContain('整数')});
 it('trims legal integers and clamps safe extremes without NaN',()=>{for(const[value,line]of[[' 7 ',7],[' -1 ',20],['001',1],[String(Number.MAX_SAFE_INTEGER),20],[String(-Number.MAX_SAFE_INTEGER),1]]as const)expect(resolveLineTarget(value,20)).toMatchObject({valid:true,line})});
});
