import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t010-App048-full-A-prep-002";export const sha=x=>createHash('sha256').update(x).digest('hex');
