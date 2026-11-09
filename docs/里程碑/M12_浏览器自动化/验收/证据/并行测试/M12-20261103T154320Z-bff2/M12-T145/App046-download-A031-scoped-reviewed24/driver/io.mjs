import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t145-App046-download-A-031";export const sha=x=>createHash('sha256').update(x).digest('hex');
