"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserSiteStateSchema = void 0;
exports.browserSiteOrigin = browserSiteOrigin;
exports.browserCertificateHost = browserCertificateHost;
const zod_1 = globalThis.__m12T017Deps.zod;
function browserSiteOrigin(raw) { try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
}
catch {
    return null;
} }
function browserCertificateHost(raw) {
    try {
        const host = raw.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
        const url = new URL('https://' + (host.includes(':') ? '[' + host + ']' : host));
        return url.hostname.replace(/^\[|\]$/g, '') === host && url.port === '' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash ? host : null;
    }
    catch {
        return null;
    }
}
const origin = zod_1.z.string().refine(value => browserSiteOrigin(value) === value, '站点须为规范HTTP(S)来源');
const host = zod_1.z.string().refine(value => browserCertificateHost(value) === value, '主机名无效');
exports.browserSiteStateSchema = zod_1.z.object({ schemaVersion: zod_1.z.literal(1), certificates: zod_1.z.array(zod_1.z.object({ host, createdAt: zod_1.z.number().finite() }).strict()), permissions: zod_1.z.array(zod_1.z.object({ origin, permission: zod_1.z.string().min(1).max(120), decision: zod_1.z.enum(['allow', 'deny']), updatedAt: zod_1.z.number().finite() }).strict()) }).strict().superRefine((value, ctx) => {
    if (new Set(value.certificates.map(row => row.host)).size !== value.certificates.length || new Set(value.permissions.map(row => JSON.stringify([row.origin, row.permission]))).size !== value.permissions.length)
        ctx.addIssue({ code: 'custom', message: '站点状态重复' });
});
