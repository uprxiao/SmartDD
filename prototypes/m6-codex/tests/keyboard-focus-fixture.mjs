export const keyboardFiles = [
 {path:'A.txt',kind:'code',text:Array.from({length:60},(_,i)=>`focusToken line ${String(i+1).padStart(2,'0')} 中文🙂`).join('\n')+'\n'},
 {path:'B.txt',kind:'code',text:'Second file B\n'},
 {path:'C.txt',kind:'code',text:'Third file C\n'},
 {path:'folder/child.txt',kind:'code',text:'Child source\n'},
];
