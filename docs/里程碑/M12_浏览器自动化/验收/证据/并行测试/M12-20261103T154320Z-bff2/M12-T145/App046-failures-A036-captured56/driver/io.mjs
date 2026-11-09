import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t145-App046-failures-A-036";export const sha=x=>createHash('sha256').update(x).digest('hex');
