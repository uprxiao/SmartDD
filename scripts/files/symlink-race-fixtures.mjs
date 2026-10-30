import {join} from 'node:path';
export const symlinkRaceVariants=['target','parent-inside','parent-outside'];
export function symlinkRacePaths(base,root,outside,id,variant){
 const parent=join(root,id),target=join(parent,'value.txt');
 const held=variant==='target'?join(parent,'value-held.txt'):variant==='parent-inside'?join(root,id+'-held'):join(base,id+'-moved-outside');
 return{base,root,outside,id,variant,parent,target,held,heldFile:variant==='target'?held:join(held,'value.txt'),link:variant==='target'?target:parent,linkTarget:variant==='target'?join(outside,'value.txt'):outside};
}
export const symlinkRaceBase=id=>'BASE '+id+' 中文🙂\r\n';
export const symlinkRaceLocal=id=>symlinkRaceBase(id)+'LOCAL retained '+id+' 中文🙂';
export const symlinkRaceCanary='OUTSIDE NEW SYMLINK TARGET MUST NOT CHANGE 中文🙂\r\n';
