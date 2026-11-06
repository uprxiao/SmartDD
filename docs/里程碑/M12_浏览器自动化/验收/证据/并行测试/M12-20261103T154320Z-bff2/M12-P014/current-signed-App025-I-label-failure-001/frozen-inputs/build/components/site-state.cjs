"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserSiteStates = void 0;
const applications_1 = require("./applications.cjs");
const browser_site_state_1 = require("./browser-site-state.cjs");
/** Decisions are data only. The future policy adapter supplies the native
 * callbacks; only trusted UI routes may call these mutation methods. */
class BrowserSiteStates {
    db;
    knownProfile;
    states = new Map();
    constructor(db, knownProfile) {
        this.db = db;
        this.knownProfile = knownProfile;
    }
    key(id) { return 'browserProfileState.v1:' + id; }
    read(id) {
        if (!this.knownProfile(id))
            throw new applications_1.ApplicationError('SCOPE_DENIED', '登录态不存在');
        const cached = this.states.get(id);
        if (cached)
            return cached;
        const row = this.db.prepare('SELECT value FROM app_settings WHERE key=?').get(this.key(id));
        let state;
        try {
            if (row && Buffer.byteLength(row.value) > 4 * 1024 * 1024)
                throw Error();
            state = row ? browser_site_state_1.browserSiteStateSchema.parse(JSON.parse(row.value)) : { schemaVersion: 1, certificates: [], permissions: [] };
        }
        catch {
            throw new applications_1.ApplicationError('BROWSER_UNAVAILABLE', '站点授权记录损坏；原记录已保留');
        }
        this.states.set(id, state);
        return state;
    }
    snapshot(id) { const state = this.read(id); return { ...state, certificates: state.certificates.map(row => ({ ...row })), permissions: state.permissions.map(row => ({ ...row })) }; }
    save(id, state) {
        const parsed = browser_site_state_1.browserSiteStateSchema.parse(state), value = JSON.stringify(parsed);
        if (Buffer.byteLength(value) > 4 * 1024 * 1024)
            throw new applications_1.ApplicationError('TOO_LARGE', '站点授权记录超过4MiB');
        this.db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(this.key(id), value, Date.now());
        this.states.set(id, parsed);
    }
    trusted(id, hostname) { const host = (0, browser_site_state_1.browserCertificateHost)(hostname); return host !== null && this.read(id).certificates.some(row => row.host === host); }
    trust(id, hostname) {
        const host = (0, browser_site_state_1.browserCertificateHost)(hostname);
        if (!host)
            throw new applications_1.ApplicationError('INVALID_INPUT', '证书例外主机名无效');
        const state = this.read(id);
        this.save(id, { ...state, certificates: [...state.certificates.filter(row => row.host !== host), { host, createdAt: Date.now() }] });
    }
    revokeCertificate(id, hostname) { const host = (0, browser_site_state_1.browserCertificateHost)(hostname); if (!host)
        throw new applications_1.ApplicationError('INVALID_INPUT', '主机名无效'); const state = this.read(id); this.save(id, { ...state, certificates: state.certificates.filter(row => row.host !== host) }); }
    permission(id, url, name) { const origin = (0, browser_site_state_1.browserSiteOrigin)(url); if (origin === null)
        return null; return this.read(id).permissions.find(row => row.origin === origin && row.permission === name)?.decision ?? null; }
    decide(id, url, names, decision) {
        const origin = (0, browser_site_state_1.browserSiteOrigin)(url);
        if (origin === null || !names.length || names.length > 16 || names.some(name => !name || name.length > 120))
            throw new applications_1.ApplicationError('INVALID_INPUT', '站点权限请求无效');
        const state = this.read(id), permissions = state.permissions.filter(row => row.origin !== origin || !names.includes(row.permission));
        for (const permission of new Set(names))
            permissions.push({ origin, permission, decision, updatedAt: Date.now() });
        this.save(id, { ...state, permissions });
    }
    revokePermission(id, url, permission) { const origin = (0, browser_site_state_1.browserSiteOrigin)(url); if (origin === null)
        throw new applications_1.ApplicationError('INVALID_INPUT', '站点无效'); const state = this.read(id); this.save(id, { ...state, permissions: state.permissions.filter(row => row.origin !== origin || row.permission !== permission) }); }
    forget(id) { this.db.prepare('DELETE FROM app_settings WHERE key=?').run(this.key(id)); this.states.delete(id); }
    /** Host-only profile-clone publication, never an IPC grant-setting entry. */
    inherit(id, state) { if (!this.knownProfile(id))
        throw new applications_1.ApplicationError('SCOPE_DENIED', '登录态不存在'); this.save(id, state); }
    invalidate(id) { this.states.delete(id); }
}
exports.BrowserSiteStates = BrowserSiteStates;
