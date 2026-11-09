export const commands={
 identity:()=>['browser','identity','get'],
 create:url=>['browser','tab','create','--url',url],
 profileShow:page=>['browser','tab','profile','show','--page',page],
 profileList:()=>['browser','tab','profile','list'],
 profileCreate:label=>['browser','tab','profile','create','--label',label,'--scope','isolated'],
 profileSet:(page,profile)=>['browser','tab','profile','set','--page',page,'--profile',profile],
 snapshot:page=>['browser','snapshot','--page',page],
 fill:(page,element,account)=>['browser','fill','--element',element,'--value',account,'--page',page],
 click:(page,element)=>['browser','click','--element',element,'--page',page],
 reload:page=>['browser','reload','--page',page],
};
