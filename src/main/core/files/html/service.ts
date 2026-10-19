import { app, session, WebContentsView, type BrowserWindow, type Session } from 'electron';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { HTML_LIMITS, HTML_SCHEME, htmlBoundsSchema, htmlOpenSchema, type HtmlOpenInput, type HtmlPreviewState, type HtmlViewBounds } from '@shared/file-html';
import { FileError, type FileRef } from '@shared/files';
import { HtmlReferenceParser } from './parser';
import { buildHtmlResources, type HtmlSource } from './resources';
import { htmlBounds, htmlLookup, htmlRequestType, HtmlResponses } from './policy';

interface Preview {
  owner: string; id: string; parent: BrowserWindow; abort: AbortController; source: HtmlSource;
  state: HtmlPreviewState; emit(value: HtmlPreviewState): void; cleanups: (() => void)[];
  parser?: HtmlReferenceParser; view?: WebContentsView; bounds?: HtmlViewBounds; sheet: boolean;
}
interface SessionSlot { session: Session; ready: Promise<void> }
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let abort: () => void = () => undefined;
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(new DOMException('HTML预览已取消', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}

export class FileHtmlService {
  private readonly previews = new Map<string, Preview>();
  private readonly sessions = new Map<string, SessionSlot>();
  private readonly cancelled = new Map<string, number>();
  constructor(private readonly resolve: (owner: string, ref: FileRef) => HtmlSource, private readonly worker = join(__dirname, 'm9-html-resources.js')) {}

  async open(owner: string, raw: HtmlOpenInput, parent: BrowserWindow, emit: (value: HtmlPreviewState) => void): Promise<HtmlPreviewState> {
    const input = htmlOpenSchema.parse(raw), key = `${owner}/${input.id}`;
    this.pruneCancelled();
    if (this.cancelled.has(key)) throw new FileError('CANCELLED', 'HTML预览已取消');
    if (parent.isDestroyed()) throw new FileError('UNTRUSTED', '文件窗口已关闭');
    const source = this.resolve(owner, input.ref);
    if (!/\.html?$/i.test(source.path) && !source.attachmentHtml) throw new FileError('UNSUPPORTED', '此文件不是HTML文档');
    if (source.hash !== input.baseHash) throw new FileError('CHANGED', 'HTML内容已改变，请重新读取');
    source.signal.throwIfAborted(); source.assert();
    const previous = this.previews.get(owner); if (previous?.id === input.id) throw new FileError('IDEMPOTENCY', 'HTML预览编号已使用');
    if (previous) this.drop(previous);
    if (this.previews.size >= 4) throw new FileError('TOO_LARGE', '当前HTML预览数量已达上限');
    const record: Preview = { owner, id: input.id, parent, source, abort: new AbortController(), state: { state: 'loading', warnings: [], blockedRequests: 0 }, emit: (value) => { try { emit(value); } catch { /* Renderer has navigated or closed; lifecycle releases the view. */ } }, cleanups: [], sheet: false };
    this.previews.set(owner, record);
    const alive = () => !record.abort.signal.aborted && this.previews.get(owner) === record;
    const invalidate = () => this.fail(record, 'HTML所属文件或目录已关闭，请重新打开');
    source.signal.addEventListener('abort', invalidate, { once: true }); record.cleanups.push(() => source.signal.removeEventListener('abort', invalidate));
    const timeout = setTimeout(() => this.fail(record, 'HTML预览超过15秒，已停止；可以重试或查看源码', true), HTML_LIMITS.timeout);
    record.cleanups.push(() => clearTimeout(timeout));
    try {
      record.parser = new HtmlReferenceParser(this.worker);
      record.abort.signal.addEventListener('abort', () => record.parser?.close(), { once: true });
      const token = randomBytes(32).toString('hex'), origin = `${HTML_SCHEME}://${token}`;
      const bundle = await abortable(buildHtmlResources(source, token, (raw, kind) => record.parser!.parse(raw, kind), record.abort.signal), record.abort.signal);
      record.parser.close(); record.parser = undefined;
      record.abort.signal.throwIfAborted(); source.assert();
      let slot = this.sessions.get(owner);
      if (!slot) {
        const isolated = session.fromPartition(`willyou-html-${randomBytes(16).toString('hex')}`, { cache: false });
        isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        isolated.setPermissionCheckHandler(() => false); isolated.setDevicePermissionHandler(() => false);
        isolated.setDisplayMediaRequestHandler((_request, callback) => callback({}));
        isolated.on('file-system-access-restricted', (_event, _details, callback) => callback('deny'));
        isolated.on('will-download', (event) => event.preventDefault());
        // WebRequest/CSP enforce the allowlist. Proxy + the WebRTC policy also
        // prevent non-HTTP peer traffic from gaining a direct network route.
        slot = { session: isolated, ready: isolated.setProxy({ mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:0;https=127.0.0.1:0;socks=127.0.0.1:0', proxyBypassRules: '<-loopback>' }) };
        this.sessions.set(owner, slot);
      }
      await abortable(slot.ready, record.abort.signal); record.abort.signal.throwIfAborted(); source.assert();
      const isolated = slot.session;
      const view = new WebContentsView({ webPreferences: { session: isolated, preload: join(__dirname, '../preload/m9-html-guard.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, devTools: false, disableDialogs: true, spellcheck: false, backgroundThrottling: false, navigateOnDragDrop: false } });
      record.view = view; view.setVisible(false); parent.contentView.addChildView(view);
      const contents = view.webContents; contents.setAudioMuted(true); contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      contents.on('preload-error', () => this.fail(record, 'HTML文件输入隔离未能加载，预览已停止'));
      // Electron's permission handlers/disableDialogs do not cover legacy file
      // inputs. Deny at Chromium's native chooser boundary before loading any
      // document code. This fixed enforcement command is not exposed as an RPC.
      await abortable(contents.loadURL('about:blank'), record.abort.signal);
      contents.debugger.attach('1.3');
      contents.debugger.on('detach', () => { if (alive()) this.fail(record, 'HTML文件选择隔离已失效，预览已停止'); });
      // Page.enable registers the chooser instrumentation. Setting interception
      // alone succeeds but does not run that instrumentation in Chromium.
      await abortable(contents.debugger.sendCommand('Page.enable'), record.abort.signal);
      await abortable(contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true }), record.abort.signal);
      record.abort.signal.throwIfAborted(); source.assert();
      const responses = new HtmlResponses(origin, bundle.resources, record.abort.signal);
      let requests = 0, initial = true, blockedTimer: ReturnType<typeof setTimeout> | undefined;
      record.cleanups.push(() => {
        clearTimeout(blockedTimer); isolated.webRequest.onBeforeRequest(null); isolated.protocol.unhandle(HTML_SCHEME); bundle.resources.clear();
        slot!.ready = Promise.all([isolated.clearStorageData(), isolated.clearCache(), isolated.closeAllConnections()]).then(() => undefined);
        void slot!.ready.catch(() => undefined); // Retain failure for the next open, without an unhandled rejection.
      });
      const blocked = () => {
        if (!alive()) return;
        record.state.blockedRequests++;
        if (!blockedTimer) blockedTimer = setTimeout(() => { blockedTimer = undefined; if (alive()) record.emit({ ...record.state }); }, 250);
      };
      isolated.protocol.handle(HTML_SCHEME, (request) => alive() ? responses.handle(request) : new Response(null, { status: 404 }));
      isolated.webRequest.onBeforeRequest((details, callback) => {
        const resource = htmlLookup(details.url, origin, bundle.resources);
        const allowed = alive() && ++requests <= HTML_LIMITS.requests && details.webContentsId === contents.id && (details.resourceType === 'mainFrame' || details.frame === contents.mainFrame) && ['GET', 'HEAD'].includes(details.method) && !!resource && htmlRequestType(details.resourceType, resource, bundle.url, initial);
        if (allowed && details.resourceType === 'mainFrame') initial = false;
        callback({ cancel: !allowed });
        if (!allowed) blocked();
        if (requests > HTML_LIMITS.requests) this.fail(record, 'HTML资源请求超过512次，预览已停止');
      });
      contents.setWindowOpenHandler(() => { blocked(); return { action: 'deny' }; });
      const deny = (event: { preventDefault(): void }) => { event.preventDefault(); blocked(); };
      contents.on('will-navigate', deny); contents.on('will-frame-navigate', deny); contents.on('will-redirect', deny);
      contents.on('will-attach-webview', deny);
      contents.on('render-process-gone', () => this.fail(record, 'HTML文档进程已退出，可以重试或查看源码'));
      contents.on('unresponsive', () => this.fail(record, 'HTML文档没有响应，预览已停止', true));
      const resize = () => this.layout(record), sheetBegin = () => { record.sheet = true; this.layout(record); }, sheetEnd = () => { record.sheet = false; this.layout(record); };
      const parentClosed = () => this.drop(record);
      parent.on('resize', resize); parent.on('hide', resize); parent.on('show', resize); parent.on('minimize', resize); parent.on('restore', resize); parent.on('sheet-begin', sheetBegin); parent.on('sheet-end', sheetEnd); parent.once('closed', parentClosed);
      record.cleanups.push(() => {
        parent.removeListener('resize', resize); parent.removeListener('hide', resize); parent.removeListener('show', resize); parent.removeListener('minimize', resize); parent.removeListener('restore', resize);
        parent.removeListener('sheet-begin', sheetBegin); parent.removeListener('sheet-end', sheetEnd); parent.removeListener('closed', parentClosed);
      });
      await abortable(contents.loadURL(bundle.url), record.abort.signal);
      await abortable(contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true }), record.abort.signal);
      record.abort.signal.throwIfAborted(); source.assert(); clearTimeout(timeout);
      record.state = { ...record.state, state: 'ready', warnings: bundle.warnings }; this.layout(record); record.emit({ ...record.state });
      // Static expression in an isolated world is solely a responsiveness check;
      // document globals cannot provide a forged heartbeat or access App data.
      let checking = false, watchdog: ReturnType<typeof setTimeout> | undefined;
      const heartbeat = setInterval(() => {
        if (!alive() || checking || contents.isDestroyed()) return;
        try { source.assert(); } catch { invalidate(); return; }
        const metrics = app.getAppMetrics().find((metric) => metric.pid === contents.getOSProcessId());
        if (metrics && metrics.memory.workingSetSize > 512 * 1024) { this.fail(record, 'HTML文档内存超过512 MiB，预览已停止', true); return; }
        checking = true; watchdog = setTimeout(() => this.fail(record, 'HTML文档连续5秒无响应，预览已停止', true), 5000);
        void contents.executeJavaScriptInIsolatedWorld(999, [{ code: '0' }]).then(() => { checking = false; clearTimeout(watchdog); }, () => { checking = false; clearTimeout(watchdog); if (alive()) this.fail(record, 'HTML文档执行环境已失效'); });
      }, 2000);
      record.cleanups.push(() => { clearInterval(heartbeat); clearTimeout(watchdog); });
      return { ...record.state };
    } catch (error) {
      if (alive()) this.fail(record, error instanceof Error ? error.message : 'HTML预览失败');
      return { ...record.state };
    }
  }
  bounds(owner: string, raw: HtmlViewBounds) {
    const input = htmlBoundsSchema.parse(raw), record = this.previews.get(owner);
    if (!record || record.id !== input.id) return;
    record.bounds = input; this.layout(record);
  }
  close(owner: string, id: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new FileError('INVALID_INPUT', 'HTML预览编号无效');
    this.pruneCancelled(); this.cancelled.set(`${owner}/${id}`, Date.now() + 60_000);
    const record = this.previews.get(owner); if (record?.id === id) this.drop(record);
  }
  closeOwner(owner: string): void {
    const record = this.previews.get(owner); if (record) this.drop(record);
    this.sessions.delete(owner); for (const key of this.cancelled.keys()) if (key.startsWith(owner + '/')) this.cancelled.delete(key);
  }
  private pruneCancelled(): void {
    for (const [key, deadline] of this.cancelled) if (deadline < Date.now()) this.cancelled.delete(key);
    while (this.cancelled.size > 2048) this.cancelled.delete(this.cancelled.keys().next().value!);
  }
  private layout(record: Preview): void {
    if (!record.view || record.parent.isDestroyed()) return;
    const input = record.bounds, [width, height] = record.parent.getContentSize();
    const rect = input ? htmlBounds(input, width, height, record.parent.webContents.getZoomFactor()) : { x: 0, y: 0, width: 0, height: 0 };
    const visible = record.state.state === 'ready' && !!input?.visible && !record.sheet && rect.width > 0 && rect.height > 0 && record.parent.isVisible() && !record.parent.isMinimized();
    if (!visible) this.returnFocus(record, record.view);
    record.view.setBounds(rect); record.view.setVisible(visible);
  }
  private returnFocus(record: Preview, view: WebContentsView): void {
    // Hiding a native child does not move its keyboard focus. Return it to the
    // App so Escape/menu shortcuts work, without stealing a system sheet's focus.
    if (!record.sheet && !record.parent.isDestroyed() && record.parent.isFocused() && record.parent.isVisible() && !record.parent.isMinimized() && !view.webContents.isDestroyed() && view.webContents.isFocused()) record.parent.webContents.focus();
  }
  private fail(record: Preview, message: string, hung = false): void {
    if (record.abort.signal.aborted) return;
    record.state = { ...record.state, state: 'failed', message }; record.emit({ ...record.state }); this.drop(record, hung);
  }
  private drop(record: Preview, hung = false): void {
    if (record.abort.signal.aborted) return;
    if (record.state.state !== 'failed') record.state = { ...record.state, state: 'closed' };
    record.abort.abort(); record.parser?.close();
    const view = record.view; record.view = undefined;
    if (view) {
      this.returnFocus(record, view);
      view.setVisible(false); if (!record.parent.isDestroyed()) record.parent.contentView.removeChildView(view);
      if (!view.webContents.isDestroyed()) { if (hung) view.webContents.forcefullyCrashRenderer(); view.webContents.close({ waitForBeforeUnload: false }); }
    }
    record.cleanups.splice(0).forEach((cleanup) => cleanup());
    if (this.previews.get(record.owner) === record) this.previews.delete(record.owner);
  }
}
