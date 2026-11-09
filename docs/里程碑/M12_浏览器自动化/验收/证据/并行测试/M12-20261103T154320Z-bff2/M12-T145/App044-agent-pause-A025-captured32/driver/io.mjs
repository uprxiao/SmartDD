import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t145-App044-agent-pause-A-025";export const sha=x=>createHash('sha256').update(x).digest('hex');
