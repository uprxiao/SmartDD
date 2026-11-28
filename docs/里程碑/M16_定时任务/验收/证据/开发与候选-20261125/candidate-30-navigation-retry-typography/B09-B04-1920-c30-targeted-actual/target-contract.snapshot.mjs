import assert from 'node:assert/strict';
const styles=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','padding','gap','textAlign','borderColor','borderWidth','borderRadius','whiteSpace','overflowX','overflowY'];
export function evaluateTarget(ui,reference){
  assert(reference?.button?.style);const buttons=ui?.buttons??[],mismatches=[];if(buttons.length!==1)return {match:false,mismatches:[{field:'count',expected:1,actual:buttons.length}]};
  const b=buttons[0],r=b.rect;const check=(field,actual,want)=>{if(actual!==want)mismatches.push({field,actual,expected:want});};
  check('text',b.text,reference.button.text);check('disabled',b.disabled,false);check('visible',r.visible,true);
  for(const f of styles)check(f,r[f],reference.button.style[f]);check('borderStyle',r.borderStyle,'solid');
  for(const f of ['width','height'])if(Math.abs(r[f]-reference.button.rect[f])>0.01||!Number.isFinite(r[f]))mismatches.push({field:f,actual:r[f],expected:reference.button.rect[f]});
  return {match:mismatches.length===0,mismatches,actualButton:{text:b.text,rect:r,disabled:b.disabled},expectedButton:{text:reference.button.text,width:reference.button.rect.width,height:reference.button.rect.height,style:reference.button.style},referenceMetadataSha:reference.metadataSha,referenceImageSha:reference.imageSha};
}
