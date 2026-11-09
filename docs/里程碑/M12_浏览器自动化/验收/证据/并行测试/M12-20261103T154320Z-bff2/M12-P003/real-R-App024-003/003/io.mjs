import{createHash}from'node:crypto';import{writeFile}from'node:fs/promises';
export const ROOT='/private/tmp/willyou-m12-t004-real-R-cont-003';
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const save=(name,value)=>writeFile(ROOT+'/'+name,JSON.stringify(value,null,2)+'\n',{mode:0o600});
