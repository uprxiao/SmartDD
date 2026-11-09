import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t145-App047-permission4-A045";export const sha=x=>createHash('sha256').update(x).digest('hex');
