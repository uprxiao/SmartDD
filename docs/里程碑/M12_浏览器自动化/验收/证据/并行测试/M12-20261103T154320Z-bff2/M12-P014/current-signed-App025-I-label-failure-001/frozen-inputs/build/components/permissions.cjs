"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserPermissions = void 0;
const node_crypto_1 = require("node:crypto");
const applications_1 = require("./applications.cjs");
const browser_site_state_1 = require("./browser-site-state.cjs");
const keys = (permission, media) => permission === 'media' && media?.length ? [...new Set(media)].map(type => 'media:' + type) : [permission];
/** Native permission checks and requests share the same profile/origin key.
 * Only the trusted browser UI controller can resolve a pending request. */
class BrowserPermissions {
    options;
    sessions = new Map();
    owners = new Map();
    pending = new Map();
    detach = new Map();
    constructor(options) {
        this.options = options;
    }
    available(profileId) { try {
        return this.options.available(profileId);
    }
    catch {
        return false;
    } }
    decision(profileId, origin, names) {
        try {
            const choices = names.map(name => this.options.states.permission(profileId, origin, name));
            return choices.includes('deny') ? false : choices.every(value => value === 'allow') ? true : null;
        }
        catch {
            return false;
        }
    }
    install(owner) {
        const { contents, profileId } = owner, session = contents.session, previous = this.owners.get(contents);
        if (previous) {
            if (previous.profileId !== profileId || previous.pageId !== owner.pageId || previous.taskId !== owner.taskId)
                throw Error('Permission owner changed without replacing contents');
            return;
        }
        const existing = this.sessions.get(session);
        if (existing && existing !== profileId)
            throw Error('Permission profiles cannot share a session');
        if (!existing) {
            this.sessions.set(session, profileId);
            session.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
                const scope = wc ? this.owners.get(wc) : null;
                if (wc && (!scope || scope.profileId !== profileId) || !this.available(profileId))
                    return false;
                const origin = (0, browser_site_state_1.browserSiteOrigin)(details.requestingUrl ?? details.securityOrigin ?? requestingOrigin);
                if (!origin)
                    return false;
                return this.decision(profileId, origin, keys(permission, details.mediaType && details.mediaType !== 'unknown' ? [details.mediaType] : undefined)) === true;
            });
            session.setPermissionRequestHandler((wc, permission, callback, details) => {
                const scope = this.owners.get(wc), origin = (0, browser_site_state_1.browserSiteOrigin)(details.requestingUrl);
                if (!scope || scope.profileId !== profileId || scope.contents.isDestroyed() || !origin || !this.available(profileId)) {
                    callback(false);
                    return;
                }
                const names = keys(permission, 'mediaTypes' in details ? details.mediaTypes : undefined), decision = this.decision(profileId, origin, names);
                if (decision !== null) {
                    callback(decision);
                    return;
                }
                // Bound an unresponsive page's outstanding native callbacks. Denial
                // here is temporary and does not manufacture a saved user decision.
                if (this.pending.size >= 64) {
                    callback(false);
                    return;
                }
                const id = (0, node_crypto_1.randomUUID)();
                this.pending.set(id, { owner: scope, prompt: { id, pageId: scope.pageId, profileId, origin, permissions: names }, callback });
                this.options.changed?.(scope.taskId);
            });
        }
        this.owners.set(contents, owner);
        const cancel = () => this.cancel(contents), navigation = (_event, _url, inPlace) => { if (!inPlace)
            cancel(); };
        const destroyed = () => { cancel(); this.owners.delete(contents); this.detach.delete(contents); };
        contents.on('did-start-navigation', navigation);
        contents.on('render-process-gone', cancel);
        contents.once('destroyed', destroyed);
        this.detach.set(contents, () => { contents.off('did-start-navigation', navigation); contents.off('render-process-gone', cancel); contents.off('destroyed', destroyed); });
    }
    snapshot(taskId, pageId) {
        const value = [...this.pending.values()].find(value => value.owner.taskId === taskId && (value.owner.pageId === pageId || value.owner.displayPageId === pageId))?.prompt;
        return value ? { ...value, permissions: [...value.permissions] } : null;
    }
    respond(taskId, id, allow) {
        const value = this.pending.get(id);
        if (!value || value.owner.taskId !== taskId)
            throw new applications_1.ApplicationError('RESOURCE_STATE_CHANGED', '站点权限提示已失效');
        if (value.owner.contents.isDestroyed() || this.owners.get(value.owner.contents) !== value.owner || !this.available(value.owner.profileId)) {
            this.pending.delete(id);
            value.callback(false);
            this.options.changed?.(taskId);
            throw new applications_1.ApplicationError('RESOURCE_STATE_CHANGED', '页面或登录态已变化，请重新请求权限');
        }
        this.options.states.decide(value.owner.profileId, value.prompt.origin, value.prompt.permissions, allow ? 'allow' : 'deny');
        this.pending.delete(id);
        try {
            value.callback(allow);
        }
        finally {
            this.options.changed?.(taskId);
        }
    }
    cancel(contents) {
        for (const [id, value] of this.pending)
            if (value.owner.contents === contents) {
                this.pending.delete(id);
                try {
                    value.callback(false);
                }
                catch { /* Native callback may already have been cancelled by navigation. */ }
                finally {
                    this.options.changed?.(value.owner.taskId);
                }
            }
    }
    dispose() {
        for (const contents of this.owners.keys())
            this.cancel(contents);
        for (const [contents, detach] of this.detach)
            if (!contents.isDestroyed())
                detach();
        for (const session of this.sessions.keys()) {
            session.setPermissionRequestHandler(null);
            session.setPermissionCheckHandler(null);
        }
        this.pending.clear();
        this.owners.clear();
        this.detach.clear();
        this.sessions.clear();
    }
}
exports.BrowserPermissions = BrowserPermissions;
