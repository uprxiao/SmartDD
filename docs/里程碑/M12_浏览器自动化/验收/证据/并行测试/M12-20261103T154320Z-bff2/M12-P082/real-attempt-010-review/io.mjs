import{createHash}from'node:crypto';export const sha=x=>createHash('sha256').update(x).digest('hex');
