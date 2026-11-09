import{writeFile}from'node:fs/promises';import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t145-App056-failures56-R001";export const sha=x=>createHash('sha256').update(x).digest('hex');

export const save=(name,value)=>writeFile(ROOT+'/'+name,JSON.stringify(value,null,2)+'\n',{mode:0o600});
