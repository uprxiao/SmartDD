import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t131-T07-T14-App030-A-R-prep-001";export const sha=b=>createHash('sha256').update(b).digest('hex');
