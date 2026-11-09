import type { PptxElementBox,PptxElementInfo } from './file-pptx-elements';

/** DrawingML Primer §5.7.4–5.7.6: transform the centre through the parent
 * chain, but multiply extents and combine rotations separately. An odd parent
 * reflection reverses the child's rotation (verified against the native
 * projection); applying the full hierarchy to corners would add shear. */
export function pptxPageBoxes(elements:readonly PptxElementInfo[]):Map<string,PptxElementBox>{
  const byId=new Map(elements.map(element=>[element.id,element])),result=new Map<string,PptxElementBox>();
  for(const element of elements){
    if(!element.box||element.hidden)continue;
    const box={...element.box};let x=box.x+box.width/2,y=box.y+box.height/2,parentId=element.parentId,valid=true;
    const seen=new Set([element.id]);
    while(parentId){
      const parent=byId.get(parentId);
      if(seen.has(parentId)||seen.size>128||!parent?.box||!parent.childFrame||parent.hidden){valid=false;break;}
      seen.add(parentId);const frame=parent.childFrame,p=parent.box;
      const sx=frame.width?p.width/frame.width:1,sy=frame.height?p.height/frame.height:1;
      const cx=p.x+p.width/2,cy=p.y+p.height/2;
      const localX=((x-frame.x)*sx-p.width/2)*(p.flipH?-1:1),localY=((y-frame.y)*sy-p.height/2)*(p.flipV?-1:1);
      const angle=p.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      x=cx+localX*cos-localY*sin;y=cy+localX*sin+localY*cos;
      box.width*=sx;box.height*=sy;box.rotation=p.rotation+(p.flipH!==p.flipV?-box.rotation:box.rotation);box.flipH=box.flipH!==p.flipH;box.flipV=box.flipV!==p.flipV;
      parentId=parent.parentId;
    }
    box.x=x-box.width/2;box.y=y-box.height/2;
    if(valid&&[box.x,box.y,box.width,box.height,box.rotation].every(Number.isFinite))result.set(element.id,box);
  }
  return result;
}
