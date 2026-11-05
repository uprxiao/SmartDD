export const commands={
 get:()=>['browser','identity','get'],
 native:()=>['browser','identity','set','--mode','native'],
 reset:()=>['browser','identity','set','--mode','clean','--reset','true'],
 create:url=>['browser','tab','create','--url',url],
};
