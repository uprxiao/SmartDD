export const commands={
 identity:()=>['browser','identity','get'],
 create:url=>['browser','tab','create','--url',url],
 snapshot:page=>['browser','snapshot','--page',page],
 read:page=>['browser','clipboard','read','--page',page],
 write:page=>['browser','clipboard','write','--text','x','--page',page],
};
