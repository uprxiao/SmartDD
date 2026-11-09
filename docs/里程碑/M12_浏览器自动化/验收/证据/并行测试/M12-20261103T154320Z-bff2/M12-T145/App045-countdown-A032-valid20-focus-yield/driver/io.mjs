import{createHash}from'node:crypto';export const ROOT="/private/tmp/willyou-m12-t145-App045-countdown-A-032";export const sha=x=>createHash('sha256').update(x).digest('hex');
