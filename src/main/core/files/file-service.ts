import { fileLanguageId } from '@shared/file-languages.mjs';
import { isNonLocalFileSource, NONLOCAL_WORKSPACE_MESSAGE } from '@shared/file-source-boundary.mjs';
import { FileLanguageService, type LanguagePreferences } from './lsp/service';
import type { LspSource } from '@shared/file-lsp';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FileViewerService, type ViewerPreferences } from './mcp/service';
import { FileOfficePagesService } from './office/pages-service';
import { LibreOfficeEngine } from './office/libreoffice-engine';
import type { OfficeSource,OfficePersistence } from './office/service';
import { FilePptxService } from './office/pptx-service';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, posix } from 'node:path';
import { FILE_LIMITS, FileError, fileCheckpointSchema, fileDraftResolutionSchema, filePathSchema, fileRefSchema, fileSaveSchema, fileScopeSchema, fileOpenSchema, type FileOpenRequest, type FileCheckpointInput, type FileCheckpointReceipt, type FileDocument, type FileDraftResolution, type FileEntry, type FileRead, type FileRef, type FileRevision, type FileSaveInput, type FileSaveReceipt, type FileScope, type RootRequest, type FileWatchUpdate } from '@shared/files';
import { NativeFileBroker, type NativeFileResult } from './native-broker';
import { FileRootsService, identityKey, scopeKey, type RootLease } from './roots';
import { FileRecoveryStore, recoveryProjectKey } from './recovery-store';
import { fileRecoveryInspectionSchema, type FileRecoveryInspectionInput, type FileRecoveryInspection } from '@shared/file-recovery';
import { FileWatchService } from './watch-service';
import { FileSearchService } from './search-service';
import { FileCloseCoordinator } from './close-coordinator';
import { directoryListSchema, type DirectoryListRequest } from '@shared/files';
import { fileDiagramSchema, type FileDiagramRequest } from '@shared/files';
import type { FileDiagramRenderer } from './diagram-renderer';
import { fileRasterSchema, type FileRasterRequest, type FileRasterPreview } from '@shared/files';
import { FileActions, type OpenerPreferences } from './actions';
import { FileGitMetadata } from './git-metadata';
import { FileMediaService } from './media-service';
import { FileResourceService } from './resource-service';
import { FILE_IMAGE_LIMIT } from '@shared/file-resource';
import { MEDIA_LIMIT } from '@shared/file-media';
import { classifyFile } from '@shared/file-classification';
import { attachmentTextKind } from '@shared/file-attachment.mjs';
import type { FileAttachmentHint } from '@shared/files';
import { FileHtmlService } from './html/service';
import type { HtmlSource } from './html/resources';
import { FileTexService, type TexConfiguration, type TexDocumentSource, type TexNativeResult } from './tex/service';
import { TEX_LIMITS } from '@shared/file-tex';
import { OFFICE_LIMITS, officeReconnectSchema, type OfficeReconnectInput } from '@shared/file-office';
import { fileActionTargetSchema, type FileActionTarget, type FileIdentity } from '@shared/files';
import type { TerminalFileSource } from './terminal-context';
import { FileOfficeService } from './office/service';
import { OfficeCalculationEngine, type OfficeEngineConfiguration } from './office/engine';
import { TERMINAL_IMAGE_LIMITS } from '@shared/terminal-image';
import { validatePptxImageContainer } from './office/pptx-image-container';

interface DocumentRecord { owner: string; scopeKey: string; lease: string; issuedRoot: RootLease; generation: number; relativePath: string; documentKey: string; revision: FileRevision; content: FileDocument['content']; writable:boolean; readOnly:boolean; attachment?: FileDocument['attachment']; abort: AbortController; missingIdentity?: FileIdentity }
interface Operation { fingerprint: string; filePath: string; result: Promise<FileSaveReceipt> }
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export class FileService {
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly operations = new Map<string, Operation>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly unresolved = new Map<string, string>();
  private readonly checkpoints = new Map<string, Promise<unknown>>();
  private readonly draftOwners = new Map<string, { owner: string; filePath: string }>();
  private readonly installationId = randomUUID();
  private readonly diagrams = new Map<string, AbortController>();
  private readonly rasters = new Map<string, AbortController>();
  private readonly resourceReads = new Map<string, AbortController>();
  private readonly cancelledReads = new Map<string, number>();
  private readonly recoveryReads = new Set<string>();
  readonly watcher: FileWatchService;
  readonly searcher: FileSearchService;
  readonly closer = new FileCloseCoordinator();
  readonly actions: FileActions;
  readonly git: FileGitMetadata;
  readonly media: FileMediaService;
  readonly resources: FileResourceService;
  readonly html: FileHtmlService;
  readonly viewers: FileViewerService;
  readonly languages: FileLanguageService;
  readonly tex: FileTexService;
  readonly office: FileOfficeService;
  readonly officePages: FileOfficePagesService;
  readonly pptx:FilePptxService;
  constructor(readonly roots: FileRootsService, private readonly broker: NativeFileBroker, readonly recovery: FileRecoveryStore, private readonly diagramRenderer?: FileDiagramRenderer, preferences?: OpenerPreferences, tex?: TexConfiguration, office?: OfficeEngineConfiguration, officeWorkerPath?:string, pages?:OfficeEngineConfiguration, pagesWorkerPath?:string,pptxWorkerPath?:string, viewerPreferences?: ViewerPreferences, languagePreferences?: LanguagePreferences) {
    this.watcher = new FileWatchService(roots, broker, recovery); this.searcher = new FileSearchService(roots, broker, recovery);
    this.languages = new FileLanguageService((owner, ref) => this.lspSource(owner, ref), languagePreferences);
    this.viewers = new FileViewerService((owner, ref) => this.viewerSource(owner, ref), viewerPreferences);
    this.html = new FileHtmlService((owner, ref) => this.htmlSource(owner, ref));
    this.tex = new FileTexService((owner, ref) => this.texSource(owner, ref), broker, tex);
    const officeSource = (owner:string,ref:FileRef,strict=false):OfficeSource => {
      const { record, lease } = this.requireDocument(owner, ref), revision = { ...record.revision };
      // An external refresh updates the disk revision, but a dirty Office
      // document remains a valid local buffer. Save compares its own baseHash.
      const assert = () => { const current=this.requireDocument(owner,ref);if(strict && current.record.revision.hash!==revision.hash)throw new FileError('CHANGED','Office 文档内容已改变'); };
      return { name: basename(record.relativePath), hash: revision.hash, size: revision.size, writable:record.writable, lifetime:record.abort.signal, signal: AbortSignal.any([record.abort.signal, lease.abort.signal]), assert, read: async (offset, length, signal) => {
        assert();
        const result = await this.readRequest<NativeFileResult>('chunk', lease, record.relativePath, { offset, length, expectedHash: revision.hash, expectedRevision: revision, resourceLimit: OFFICE_LIMITS.inputBytes }, AbortSignal.any([record.abort.signal, lease.abort.signal, signal]));
        assert(); return Buffer.from(result.base64!, 'base64');
      } };
    };
    const layout=pages ? new LibreOfficeEngine(broker,pages) : undefined;
    const persistence:OfficePersistence={
      checkpoint:(owner,input)=>this.checkpointDocument(owner,input), save:(owner,input)=>this.saveDocument(owner,input),
      readDraft:(owner,ref,id)=>this.readDraft(owner,ref,id), resolveDraft:(owner,input)=>this.resolveDraft(owner,input), refresh:(owner,ref)=>this.refresh(owner,ref),
    };
    this.officePages = new FileOfficePagesService((owner,ref)=>officeSource(owner,ref,true),layout,pagesWorkerPath);
    this.pptx=new FilePptxService(officeSource,persistence,layout,pptxWorkerPath,undefined,(image,signal)=>broker.request({operation:'raster-inspect',...image},{signal}));
    this.office = new FileOfficeService(officeSource, officeWorkerPath, undefined, office ? new OfficeCalculationEngine(broker, office) : undefined,persistence,(image,signal)=>broker.request({operation:'raster-inspect',...image},{signal}));
    const resourceSource = (owner: string, ref: FileRef, media: boolean) => {
      const { record, lease } = this.requireDocument(owner, ref), revision = { ...record.revision };
      const content = record.content, resourceLimit = media ? MEDIA_LIMIT : content?.kind === 'pdf' ? FILE_LIMITS.asset : FILE_IMAGE_LIMIT;
      return { name: basename(record.relativePath), revision, content, signal: AbortSignal.any([record.abort.signal, lease.abort.signal]), read: async (offset: number, length: number, signal: AbortSignal) => {
        const current = this.requireDocument(owner, ref);
        if (current.record.revision.hash !== revision.hash) throw new FileError('CHANGED', '媒体内容已改变');
        const result = await this.readRequest<NativeFileResult>('chunk', lease, record.relativePath, { offset, length, expectedHash: revision.hash, expectedRevision: revision, resourceLimit }, AbortSignal.any([record.abort.signal, lease.abort.signal, signal]));
        this.requireDocument(owner, ref); return Buffer.from(result.base64!, 'base64');
      } };
    };
    this.media = new FileMediaService((owner, ref) => resourceSource(owner, ref, true));
    this.resources = new FileResourceService((owner, ref) => resourceSource(owner, ref, false));
    this.git = new FileGitMetadata(roots, broker, recovery, (owner, ref) => {
      const { record, lease } = this.requireDocument(owner, ref);
      return { lease, relativePath: record.relativePath, revision: record.revision, signal: record.abort.signal };
    });
    this.actions = new FileActions((owner, target) => {
      if (target.kind === 'document') { const { record, lease } = this.requireDocument(owner, target.ref); return { lease, relativePath: record.relativePath, directory: false, identity: { device: record.revision.device, inode: record.revision.inode }, signal: AbortSignal.any([lease.abort.signal, record.abort.signal]) }; }
      const lease = roots.require(owner, target.path); return { lease, relativePath: target.path.relativePath, directory: target.directory, signal: lease.abort.signal };
    }, roots, broker, recovery, preferences);
  }

  /** Renew a retained workbook only within its original authorized source and
   * physical file. This does not rebase, reopen, or discard model/history. */
  reconnectOffice(owner:string,raw:OfficeReconnectInput) {
    const input=officeReconnectSchema.parse(raw);
    return this.office.reconnect(owner,input,async oldRef=>{
      const document=await this.refresh(owner,input.ref);
      const old=this.requireIssuedDocument(owner,oldRef),next=this.requireDocument(owner,input.ref);
      if(old.record.scopeKey!==next.record.scopeKey || old.lease.source!==next.lease.source || old.lease.sourceId!==next.lease.sourceId || old.lease.projectId!==next.lease.projectId || identityKey(old.lease.identity)!==identityKey(next.lease.identity) || old.record.relativePath!==next.record.relativePath || identityKey(old.record.revision)!==identityKey(next.record.revision) || old.record.readOnly && !next.record.readOnly)throw new FileError('UNTRUSTED','重新关联的来源或物理文件已改变；原工作簿与草稿仍保留');
      return document;
    });
  }

  viewerSource(owner: string, ref: FileRef) {
    const { record, lease } = this.requireDocument(owner, ref);
    return {
      name: basename(record.relativePath), source: lease.source, rootPath: lease.canonicalPath,
      signal: AbortSignal.any([record.abort.signal, lease.abort.signal]),
      assert: () => { this.requireDocument(owner, ref); },
      read: async (signal?: AbortSignal): Promise<FileRead> => {
        const current = this.requireDocument(owner, ref);
        const result = await this.readRequest<NativeFileResult>('read', current.lease, current.record.relativePath, { byteLimit: 20 * 1024 * 1024 }, AbortSignal.any([current.record.abort.signal, signal ?? current.record.abort.signal]));
        this.requireDocument(owner, ref);
        return { document: this.document(owner, current.lease, result, ref.id), base64: result.base64! };
      },
      save: (input: FileSaveInput) => this.save(owner, input),
    };
  }
  async lspSource(owner: string, ref: FileRef): Promise<LspSource> {
    const { record, lease } = this.requireDocument(owner, ref);
    const original = await this.terminalSource(owner, { kind: 'document', ref });
    const file = await this.refresh(owner, ref); await original.inspect();
    if (file.content?.kind !== 'text') throw new FileError('UNSUPPORTED', '此文件不提供文本语言服务');
    const assert = () => {
      original.assert(); const current = this.requireDocument(owner, ref).record.revision;
      if (current.device !== original.revision.device || current.inode !== original.revision.inode) throw new FileError('CHANGED', '语言服务源文件身份已改变');
    };
    const referenceLanguage = fileLanguageId(file.name) ?? 'plaintext';
    const language = ({ tsx: 'typescriptreact', jsx: 'javascriptreact', 'c++': 'cpp', zsh: 'shellscript', 'angular-ts': 'typescript', 'angular-html': 'html' } as Record<string, string>)[referenceLanguage] ?? referenceLanguage;
    return { ref, root: { lease: lease.lease, generation: lease.generation }, rootPath: lease.canonicalPath, absolutePath: original.absolutePath, relativePath: record.relativePath, projectId: lease.projectId, language, signal: original.signal, assert,
      resolve: async value => {
        assert(); let url: URL; try { url = new URL(value); } catch { throw new FileError('INVALID_INPUT', '语言服务返回了无效 URI'); }
        if (url.protocol !== 'file:' || url.search || url.hash || url.hostname && url.hostname !== 'localhost') throw new FileError('UNTRUSTED', '语言服务结果不是本机文件 URI');
        const path = fileURLToPath(url); if (path.includes('\0')) throw new FileError('INVALID_INPUT', '语言服务路径无效');
        const canonical = await realpath(path); assert();
        const relativePath = posix.relative(lease.canonicalPath, canonical);
        if (relativePath === '..' || relativePath.startsWith('../') || posix.isAbsolute(relativePath)) return { relativePath: null, displayPath: canonical, outsideRoot: true };
        filePathSchema.parse(relativePath);
        const checked = await this.open(owner, { lease: lease.lease, generation: lease.generation, relativePath });
        this.closeDocument(owner, checked.ref); assert();
        return { relativePath, displayPath: relativePath, outsideRoot: false };
      },
    };
  }

  async terminalSource(owner: string, raw: FileActionTarget, expected?: FileIdentity): Promise<TerminalFileSource> {
    const target = fileActionTargetSchema.parse(raw);
    if (target.kind === 'path' && target.directory) throw new FileError('NOT_REGULAR', '仅真实文件可插入终端');
    const document = target.kind === 'document' ? this.requireDocument(owner, target.ref) : null;
    const lease = document?.lease ?? this.roots.require(owner, target.kind === 'path' ? target.path : target.ref);
    const relativePath = document?.record.relativePath ?? (target.kind === 'path' ? target.path.relativePath : '');
    const initial = document?.record.revision ?? expected;
    const signal = document ? AbortSignal.any([lease.abort.signal, document.record.abort.signal]) : lease.abort.signal;
    const assert = () => {
      this.roots.require(owner, lease);
      if (signal.aborted) throw new FileError('CANCELLED', '引用的文件来源已关闭');
      if (target.kind === 'document') this.requireDocument(owner, target.ref);
    };
    await this.recovery.ready(); assert();
    const result = await this.readRequest<NativeFileResult>('stat', lease, relativePath, {}, signal); assert();
    if (initial && (initial.device !== result.revision.device || initial.inode !== result.revision.inode)) throw new FileError('CHANGED', '文件已被替换，请刷新后重新选择');
    if (expected && (expected.device !== result.revision.device || expected.inode !== result.revision.inode)) throw new FileError('CHANGED', '捕获的文件已被替换，请重新选择');
    const revision = { ...result.revision };
    return { relativePath: result.relativePath, absolutePath: join(lease.canonicalPath, result.relativePath), revision, signal, assert, inspect: async () => {
      assert();
      const current = await this.readRequest<NativeFileResult>('stat', lease, result.relativePath, {}, signal); assert();
      if (current.revision.device !== revision.device || current.revision.inode !== revision.inode) throw new FileError('CHANGED', '引用文件已被替换，请重新选择');
      return current.revision;
    } };
  }

  async terminalImageSource(owner: string, ref: FileRef, baseHash: string) {
    const { record, lease } = this.requireDocument(owner, ref);
    if (record.content?.kind !== 'image' || record.content.mime !== 'image/png') throw new FileError('UNSUPPORTED', '当前图片输入适配器仅验证过静态 PNG，请选择 PNG 原图');
    if (record.revision.hash !== baseHash) throw new FileError('CHANGED', '预览的图片已改变，请重新打开后再附加');
    const source = await this.terminalSource(owner, { kind: 'document', ref }, record.revision);
    if (source.revision.hash !== baseHash) throw new FileError('CHANGED', '图片原件已改变，未附加');
    if (source.revision.size < 1 || source.revision.size > TERMINAL_IMAGE_LIMITS.bytes) throw new FileError('TOO_LARGE', '当前图片输入最多支持 20 MiB 的静态 PNG');
    return { ...source, name: basename(record.relativePath), mime: 'image/png' as const, read: async () => {
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < source.revision.size; offset += FILE_LIMITS.chunk) {
        source.assert(); const length = Math.min(FILE_LIMITS.chunk, source.revision.size - offset);
        const chunk = await this.readRequest<NativeFileResult>('chunk', lease, record.relativePath, { offset, length, expectedHash: baseHash, expectedRevision: source.revision, resourceLimit: TERMINAL_IMAGE_LIMITS.bytes }, source.signal);
        source.assert(); const bytes = Buffer.from(chunk.base64!, 'base64');
        if (bytes.length !== length) throw new FileError('CHANGED', '图片原件读取不完整，未附加');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (hash(bytes) !== baseHash) throw new FileError('CHANGED', '图片原件校验失败，未附加');
      // ImageIO may recover a truncated PNG and report it complete. Reuse the
      // bounded container/CRC/scanline check before native decode or PTY input.
      validatePptxImageContainer(bytes, 'image/png');
      // Decode only for admission; retain and deliver the exact original bytes.
      // This existing native path bounds static PNG to 20 MiB/16 megapixels.
      try { await this.broker.request({ operation: 'raster-inspect', mime: 'image/png', base64: bytes.toString('base64') }, { signal: source.signal }); }
      catch { source.assert(); throw new FileError('UNSUPPORTED', '图片不是完整静态 PNG，或超过 1600 万像素／单边 8192 像素的输入上限'); }
      source.assert(); const current = await source.inspect();
      if (current.hash !== baseHash) throw new FileError('CHANGED', '图片在准备时已改变，未附加');
      return bytes;
    } };
  }

  htmlSource(owner: string, ref: FileRef): HtmlSource {
    const { record, lease } = this.requireDocument(owner, ref), baseHash = record.revision.hash;
    const assert = () => { if (this.requireDocument(owner, ref).record.revision.hash !== baseHash) throw new FileError('CHANGED', 'HTML文档内容已改变'); };
    return { path: record.relativePath, hash: baseHash, ...(record.readOnly && record.attachment?.textKind === 'html' ? { attachmentHtml: true } : {}), signal: AbortSignal.any([record.abort.signal, lease.abort.signal]), assert, read: async (relativePath, byteLimit, signal) => {
      filePathSchema.parse(relativePath); assert();
      const result = await this.readRequest<NativeFileResult>('read', lease, relativePath, { byteLimit }, AbortSignal.any([record.abort.signal, signal]));
      assert(); return { bytes: new Uint8Array(Buffer.from(result.base64!, 'base64')), hash: result.revision.hash };
    } };
  }
  texSource(owner: string, ref: FileRef): TexDocumentSource {
    const { record, lease } = this.requireDocument(owner, ref), baseHash = record.revision.hash;
    const assert = () => { if (this.requireDocument(owner, ref).record.revision.hash !== baseHash) throw new FileError('CHANGED', 'TeX 源码内容已改变'); };
    return { path: record.relativePath, hash: baseHash, signal: AbortSignal.any([record.abort.signal, lease.abort.signal]), assert,
      stat: async (path, signal) => { filePathSchema.parse(path); assert(); const result = await this.readRequest<NativeFileResult>('stat', lease, path, { byteLimit: TEX_LIMITS.snapshotBytes }, AbortSignal.any([record.abort.signal, signal])); assert(); return result.revision; },
      read: async (path, signal, byteLimit = TEX_LIMITS.sourceBytes) => {
        filePathSchema.parse(path); assert(); const cancel = AbortSignal.any([record.abort.signal, signal]);
        if (byteLimit === TEX_LIMITS.sourceBytes) {
          const result = await this.readRequest<NativeFileResult>('read', lease, path, { byteLimit }, cancel);
          assert(); return { bytes: new Uint8Array(Buffer.from(result.base64!, 'base64')), hash: result.revision.hash };
        }
        if (byteLimit !== TEX_LIMITS.outputBytes || !/\.pdf$/i.test(path)) throw new FileError('INVALID_INPUT', 'TeX PDF 资源预算无效');
        const result = await this.readRequest<NativeFileResult>('stat', lease, path, {}, cancel);
        if (result.revision.size > byteLimit) throw new FileError('TOO_LARGE', 'TeX PDF 图片超过 40 MiB');
        const bytes = Buffer.alloc(result.revision.size);
        for (let offset = 0; offset < bytes.length; offset += TEX_LIMITS.chunkBytes) {
          assert(); const length = Math.min(TEX_LIMITS.chunkBytes, bytes.length - offset);
          const chunk = await this.readRequest<NativeFileResult>('chunk', lease, path, { offset, length, expectedRevision: result.revision, resourceLimit: byteLimit }, cancel);
          const decoded = Buffer.from(chunk.base64!, 'base64'); if (decoded.length !== length) throw new FileError('CHANGED', 'TeX PDF 读取不完整'); decoded.copy(bytes, offset);
        }
        assert(); if (createHash('sha256').update(bytes).digest('hex') !== result.revision.hash) throw new FileError('CHANGED', 'TeX PDF 内容改变');
        return { bytes, hash: result.revision.hash };
      },
      compile: async (snapshot, resources, job, wallMs, signal) => {
        await this.recovery.ready(); assert();
        const result = await this.broker.request<TexNativeResult>({ operation: 'tex-compile', root: lease.descriptor, protected: this.recovery.protectedIdentities(), entry: record.relativePath, baseHash, files: snapshot.files, ...resources, job, wallMs }, { signal: AbortSignal.any([record.abort.signal, lease.abort.signal, signal]), timeoutMs: wallMs + 15_000 });
        assert(); return result;
      },
    };
  }
  async diagram(owner: string, ref: FileRef, raw: FileDiagramRequest): Promise<string> {
    const input = fileDiagramSchema.parse(raw), { record, lease } = this.requireDocument(owner, ref), key = `${owner}/${input.id}`;
    if (!this.diagramRenderer) throw new FileError('UNSUPPORTED', '图表渲染器不可用');
    if (this.diagrams.has(key)) throw new FileError('IDEMPOTENCY', '图表请求编号已使用');
    const abort = new AbortController(); this.diagrams.set(key, abort);
    try { const result = await this.diagramRenderer.render(input.source, input.theme, AbortSignal.any([record.abort.signal, lease.abort.signal, abort.signal])); this.requireDocument(owner, ref); return result; }
    finally { this.diagrams.delete(key); }
  }
  cancelDiagram(owner: string, id: string): void { this.diagrams.get(`${owner}/${id}`)?.abort(); }

  async raster(owner: string, ref: FileRef, raw: FileRasterRequest): Promise<FileRasterPreview> {
    const input = fileRasterSchema.parse(raw), { record, lease } = this.requireDocument(owner, ref), key = `${owner}/${input.id}`;
    if (record.revision.hash !== input.baseHash) throw new FileError('CHANGED', '图像所属文档已更新');
    if (this.rasters.has(key)) throw new FileError('IDEMPOTENCY', '图像请求编号已使用');
    if ([...this.rasters.keys()].filter((id) => id.startsWith(owner + '/')).length >= 8) throw new FileError('TOO_LARGE', '当前图像解码队列已满');
    const bytes = Buffer.from(input.base64, 'base64');
    if (!bytes.length || bytes.length > FILE_LIMITS.notebook || bytes.toString('base64') !== input.base64) throw new FileError('INVALID_INPUT', '图像数据编码无效或超过 40 MiB');
    const abort = new AbortController(); this.rasters.set(key, abort);
    try {
      const result = await this.broker.request<FileRasterPreview>({ operation: 'raster-preview', base64: input.base64, mime: input.mime }, { signal: AbortSignal.any([record.abort.signal, lease.abort.signal, abort.signal]) });
      if (this.requireDocument(owner, ref).record.revision.hash !== input.baseHash) throw new FileError('CHANGED', '图像所属文档已更新');
      return result;
    } finally { this.rasters.delete(key); }
  }
  cancelRaster(owner: string, id: string): void { this.rasters.get(`${owner}/${id}`)?.abort(); }

  async watch(owner: string, input: RootRequest, directories: string[], refs: FileRef[], emit: (event: FileWatchUpdate) => void, id?: string) {
    await this.recovery.ready();
    const lease = this.roots.require(owner, input);
    if (!Array.isArray(directories) || directories.length > 2000 || !Array.isArray(refs) || refs.length > 200) throw new FileError('TOO_LARGE', '监听目录或文件数超过单工作区预算');
    const paths = [...new Set(directories.map((path) => filePathSchema.parse(path)))];
    const files = [...new Set(refs.map((ref) => { const document = this.requireDocument(owner, ref); if (document.lease !== lease) throw new FileError('UNTRUSTED', '监听文件不属于此目录来源'); return document.record.relativePath; }))];
    if (id) { this.watcher.configure(owner, id, lease, paths, files); return null; }
    return this.watcher.start(owner, lease, paths, files, emit);
  }

  openScope(owner: string, scope: FileScope) {
    if (isNonLocalFileSource(scope)) throw new FileError('UNSUPPORTED', NONLOCAL_WORKSPACE_MESSAGE);
    this.closeScope(owner, scope); return this.roots.open(owner, scope);
  }
  closeScope(owner: string, input: FileScope): void {
    const scope = fileScopeSchema.parse(input);
    this.roots.closeScope(owner, scope);
    for (const [id, record] of this.documents) if (record.owner === owner && record.scopeKey === scopeKey(scope)) { record.abort.abort(); this.documents.delete(id); }
  }

  async list(owner: string, input: DirectoryListRequest): Promise<FileEntry[]> {
    const request = directoryListSchema.parse(input); await this.recovery.ready(); const lease = this.roots.require(owner, request);
    const key = request.requestId ? `${owner}/${request.requestId}` : null, abort = new AbortController();
    if (key) {
      if (this.cancelledReads.has(key)) throw new FileError('CANCELLED', '目录读取已取消');
      if (this.resourceReads.has(key)) throw new FileError('IDEMPOTENCY', '同一目录读取请求仍在执行');
      this.resourceReads.set(key, abort);
    }
    try {
      const result = await this.readRequest<{ entries: FileEntry[] }>('list', lease, request.relativePath, request.requestId ? { requestId: request.requestId } : {}, abort.signal);
      if (abort.signal.aborted) throw new FileError('CANCELLED', '目录读取已取消');
      this.roots.require(owner, request);
      // The broker resolves aliases for authorization and physical identity.
      // A tree row still belongs to the requested navigation directory: using
      // the canonical child path here gives two expanded aliases the same key.
      return result.entries.filter((e) => !this.recovery.isProtected(e.identity))
        .map((entry) => ({ ...entry, relativePath: posix.join(request.relativePath, entry.name) }))
        .sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name));
    } finally { if (key && this.resourceReads.get(key) === abort) this.resourceReads.delete(key); }
  }
  async open(owner: string, input: FileOpenRequest): Promise<FileDocument> {
    const request = fileOpenSchema.parse(input); await this.recovery.ready(); const lease = this.roots.require(owner, request);
    let result: NativeFileResult;
    try { result = await this.readRequest<NativeFileResult>('stat', lease, request.relativePath); }
    catch (error) {
      if (!(error instanceof FileError) || error.code !== 'TOO_LARGE') throw error;
      // stat correctly refuses to hash bodies above the asset ceiling. Ask
      // the same trusted broker for metadata only, without inventing a hash
      // or issuing a capability for an unread body. Canonical filename type
      // still takes precedence over size for explicitly unsupported formats.
      const metadata = await this.readRequest<{ relativePath: string; size: number }>('metadata', lease, request.relativePath);
      this.roots.require(owner, request);
      const content = classifyFile(basename(metadata.relativePath), new Uint8Array());
      if (content.kind === 'unsupported') throw new FileError('UNSUPPORTED', content.reason ?? '此文件类型不支持预览');
      if (metadata.size > FILE_LIMITS.asset) throw new FileError('TOO_LARGE', '文件超过 256 MiB 只读预览上限；可使用外部应用打开');
      // An external replacement may have shrunk the file between requests.
      // Obtain a real revision once; never promote metadata into a document.
      result = await this.readRequest<NativeFileResult>('stat', lease, request.relativePath);
    }
    this.roots.require(owner, request);
    return this.document(owner, lease, result, undefined, request.readOnly, request.attachment);
  }
  async related(owner: string, input: FileRef, href: string): Promise<FileDocument> {
    const { record, lease } = this.requireDocument(owner, input);
    if (typeof href !== 'string' || href.length > 32768 || /[\u0000-\u001f\\]/.test(href) || /^[a-z][\w+.-]*:|^\/\//i.test(href)) throw new FileError('INVALID_INPUT', '文档引用不是可解析的本机文件路径');
    let path: string;
    try { path = decodeURIComponent(href.split(/[?#]/, 1)[0]); } catch { throw new FileError('INVALID_INPUT', '文档引用包含无效路径编码'); }
    const absolute = path.startsWith('/') ? path : posix.resolve(lease.canonicalPath, posix.dirname(record.relativePath), path);
    const relativePath = posix.relative(lease.canonicalPath, absolute);
    filePathSchema.parse(relativePath);
    return this.open(owner, { lease: lease.lease, generation: lease.generation, relativePath, readOnly: record.readOnly, ...(record.attachment ? { attachment: {} } : {}) });
  }
  async read(owner: string, input: FileRef): Promise<FileRead> {
    const { lease } = this.requireDocument(owner, input);
    const result = await this.documentRequest(owner, input, 'read');
    this.requireDocument(owner, input);
    return { document: this.document(owner, lease, result, input.id), base64: result.base64! };
  }
  async refresh(owner: string, input: FileRef): Promise<FileDocument> {
    const { lease } = this.requireDocument(owner, input);
    const result = await this.documentRequest(owner, input, 'stat');
    this.requireDocument(owner, input); return this.document(owner, lease, result, input.id);
  }
  async chunk(owner: string, input: FileRef, offset: number, length: number, expectedHash: string, requestId?: string): Promise<string> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > FILE_LIMITS.chunk || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new FileError('INVALID_INPUT', '资源分块参数无效');
    const { record, lease } = this.requireDocument(owner, input);
    if (record.revision.hash !== expectedHash) throw new FileError('CHANGED', '资源内容版本已改变');
    if (requestId !== undefined && !/^[a-f0-9-]{36}$/.test(requestId)) throw new FileError('INVALID_INPUT', '资源读取编号无效');
    const key = requestId ? `${owner}/${requestId}` : null, abort = new AbortController();
    if (key) {
      if (this.cancelledReads.has(key)) throw new FileError('CANCELLED', '资源读取已取消');
      if (this.resourceReads.has(key)) throw new FileError('IDEMPOTENCY', '同一资源不能并发读取多个分块');
      this.resourceReads.set(key, abort);
    }
    try {
      const result = await this.readRequest<NativeFileResult>('chunk', lease, record.relativePath, { offset, length, expectedHash, expectedRevision: record.revision }, AbortSignal.any([record.abort.signal, abort.signal]));
      this.requireDocument(owner, input); return result.base64!;
    } finally { if (key && this.resourceReads.get(key) === abort) this.resourceReads.delete(key); }
  }
  cancelResource(owner: string, id: string): void {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new FileError('INVALID_INPUT', '资源读取编号无效');
    const key = `${owner}/${id}`; this.resourceReads.get(key)?.abort();
    const now = Date.now(); for (const [old, deadline] of this.cancelledReads) if (deadline < now) this.cancelledReads.delete(old);
    this.cancelledReads.set(key, now + 60_000);
    while (this.cancelledReads.size > 2048) this.cancelledReads.delete(this.cancelledReads.keys().next().value!);
  }
  async inspectRecovery(owner: string, raw: FileRecoveryInspectionInput): Promise<FileRecoveryInspection> {
    const input = fileRecoveryInspectionSchema.parse(raw), key = `${owner}/${input.requestId}`;
    if (this.cancelledReads.has(key)) throw new FileError('CANCELLED', '恢复材料读取已取消');
    if (this.resourceReads.has(key)) throw new FileError('IDEMPOTENCY', '同一恢复核对请求仍在读取');
    if ([...this.recoveryReads].filter(id => id.startsWith(owner + '/')).length >= 4) throw new FileError('QUOTA', '同时核对的恢复记录过多，请稍后重试');
    const abort = new AbortController(); this.resourceReads.set(key, abort); this.recoveryReads.add(key);
    try {
      const result = await this.recovery.inspect(input, { signal: abort.signal });
      if (abort.signal.aborted) throw new FileError('CANCELLED', '恢复材料读取已取消');
      return result;
    } finally { if (this.resourceReads.get(key) === abort) this.resourceReads.delete(key); this.recoveryReads.delete(key); }
  }
  closeDocument(owner: string, input: FileRef): void { this.requireIssuedDocument(owner, input).record.abort.abort(); this.documents.delete(input.id); }
  closeOwner(owner: string): void {
    this.languages.closeOwner(owner);
    this.viewers.closeOwner(owner);
    this.office.closeOwner(owner);
    this.officePages.closeOwner(owner);
    this.pptx.closeOwner(owner);
    this.tex.closeOwner(owner);
    this.html.closeOwner(owner);
    this.media.closeOwner(owner);
    this.resources.closeOwner(owner);
    this.git.closeOwner(owner);
    this.actions.closeOwner(owner);
    this.closer.closeOwner(owner);
    this.searcher.closeOwner(owner);
    this.roots.closeOwner(owner);
    for (const [id, record] of this.documents) if (record.owner === owner) { record.abort.abort(); this.documents.delete(id); }
    for (const [id, claim] of this.draftOwners) if (claim.owner === owner) this.draftOwners.delete(id);
    for (const [id, abort] of this.resourceReads) if (id.startsWith(owner + '/')) { abort.abort(); this.resourceReads.delete(id); }
    for (const id of this.cancelledReads.keys()) if (id.startsWith(owner + '/')) this.cancelledReads.delete(id);
  }
  async checkpoint(owner: string, raw: FileCheckpointInput): Promise<FileCheckpointReceipt> {
    const input=fileCheckpointSchema.parse(raw),{record}=this.requireIssuedDocument(owner,input.ref);
    if(record.content?.kind==='office')throw new FileError('UNTRUSTED','Office 草稿必须通过文档保真校验');
    return this.checkpointDocument(owner,input);
  }
  private async checkpointDocument(owner: string, raw: FileCheckpointInput): Promise<FileCheckpointReceipt> {
    const input = fileCheckpointSchema.parse(raw);
    // A previously opened buffer may persist private recovery bytes after its
    // source is disconnected/reconfigured. This does not authorize source IO.
    const { record, lease } = this.requireIssuedDocument(owner, input.ref), bytes = Buffer.from(input.base64, 'base64');
    if (record.readOnly) throw new FileError('PERMISSION', '此来源为只读，不能创建编辑草稿');
    if (bytes.length > (input.encoding === 'ooxml-draft' ? FILE_LIMITS.officeDraft : FILE_LIMITS.readableText) || bytes.toString('base64') !== input.base64) throw new FileError('INVALID_INPUT', '草稿字节无效或超过上限');
    if (input.encoding === 'ooxml-draft' && (!/\.(xlsx|pptx)$/i.test(record.relativePath) || input.bom)) throw new FileError('INVALID_INPUT', 'Office 草稿类型无效');
    const projectKey = recoveryProjectKey(lease.projectId), key = `${projectKey}/${input.draftId}`;
    this.claimDraft(key, owner, join(lease.canonicalPath, record.relativePath));
    const fingerprint = hash(JSON.stringify({ root: lease.descriptor, path: record.relativePath, scope: lease.scope }));
    return this.queueCheckpoint(key, async () => {
      await this.recovery.ready();
      this.requireIssuedDocument(owner, input.ref);
      this.recovery.reserve(projectKey, input.draftId, bytes.length, bytes.length);
      const receipt = await this.broker.request<FileCheckpointReceipt>({ operation: 'checkpoint', root: lease.descriptor, relativePath: record.relativePath, recoveryRoot: this.recovery.descriptor(), source: { kind: lease.source, id: lease.sourceId, scope: lease.scope }, projectKey, fingerprint, draftId: input.draftId, bufferVersion: input.bufferVersion, baseHash: input.baseHash, base64: input.base64, encoding: input.encoding, bom: input.bom }, { signal: record.abort.signal });
      await this.recovery.refreshRecord(projectKey, input.draftId);
      this.requireIssuedDocument(owner, input.ref); return receipt;
    });
  }
  drafts(owner: string, ref: FileRef) {
    const { record, lease } = this.requireIssuedDocument(owner, ref);
    if (record.readOnly) return [];
    return this.recovery.drafts(lease, record.relativePath);
  }
  async readDraft(owner: string, ref: FileRef, draftId: string) {
    const { record, lease } = this.requireIssuedDocument(owner, ref);
    if (record.readOnly) throw new FileError('PERMISSION', '此来源为只读，不能恢复编辑草稿');
    const result = await this.recovery.readDraft(lease, record.relativePath, draftId);
    this.requireIssuedDocument(owner, ref);
    this.claimDraft(`${recoveryProjectKey(lease.projectId)}/${draftId}`, owner, join(lease.canonicalPath, record.relativePath));
    return result;
  }
  async resolveDraft(owner: string, raw: FileDraftResolution): Promise<{ resolved: boolean }> {
    const input = fileDraftResolutionSchema.parse(raw), { record, lease } = this.requireIssuedDocument(owner, input.ref);
    if (record.readOnly) throw new FileError('PERMISSION', '此来源为只读，不能处理编辑草稿');
    const projectKey = recoveryProjectKey(lease.projectId), key = `${projectKey}/${input.draftId}`;
    this.claimDraft(key, owner, join(lease.canonicalPath, record.relativePath));
    return this.queueCheckpoint(key, async () => {
    if (input.action === 'saved') {
      const operation = this.operations.get(`${projectKey}/${input.saveOpId}`) ?? this.recovery.existing(projectKey, input.saveOpId!);
      const receipt = operation && ('result' in operation ? await operation.result : operation.receipt);
      if (!receipt || operation?.filePath !== join(lease.canonicalPath, record.relativePath) || receipt.state !== 'saved' || receipt.bufferVersion !== input.bufferVersion || receipt.revision?.hash !== (input.savedHash ?? input.hash)) throw new FileError('UNTRUSTED', '无法用此保存回执清除当前草稿');
    }
    this.requireIssuedDocument(owner, input.ref);
    const fingerprint = hash(JSON.stringify({ root: lease.descriptor, path: record.relativePath, scope: lease.scope }));
    const result = await this.broker.request<{ resolved: boolean }>({ operation: 'resolve-checkpoint', recoveryRoot: this.recovery.descriptor(), projectKey, draftId: input.draftId, bufferVersion: input.bufferVersion, hash: input.hash, fingerprint });
    await this.recovery.refreshRecord(projectKey, input.draftId);
      this.requireIssuedDocument(owner, input.ref); return result;
    });
  }

  private claimDraft(key: string, owner: string, filePath: string): void {
    const previous = this.draftOwners.get(key);
    if (previous && (previous.owner !== owner || previous.filePath !== filePath)) throw new FileError('UNTRUSTED', '此草稿属于另一窗口或文件');
    this.draftOwners.set(key, { owner, filePath });
  }
  private queueCheckpoint<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.checkpoints.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.checkpoints.set(key, result);
    void result.finally(() => { if (this.checkpoints.get(key) === result) this.checkpoints.delete(key); }).catch(() => undefined);
    return result;
  }

  async save(owner: string, raw: FileSaveInput): Promise<FileSaveReceipt> {
    const input=fileSaveSchema.parse(raw),{record}=this.requireDocument(owner,input.ref);
    if(record.content?.kind==='office')throw new FileError('UNTRUSTED','Office 原件必须通过文档保真校验后保存');
    return this.saveDocument(owner,input);
  }
  private async saveDocument(owner: string, raw: FileSaveInput): Promise<FileSaveReceipt> {
    const input = fileSaveSchema.parse(raw); await this.recovery.ready();
    const { record, lease } = this.requireDocument(owner, input.ref);
    if (record.readOnly) throw new FileError('PERMISSION', '此来源为只读，不能保存原文件');
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length > FILE_LIMITS.asset || bytes.toString('base64') !== input.base64) throw new FileError('INVALID_INPUT', '文件保存内容不是合法的 Base64 字节');
    const projectKey = recoveryProjectKey(lease.projectId), key = `${projectKey}/${input.opId}`;
    const fingerprint = hash(JSON.stringify({ root: lease.descriptor, path: record.relativePath, baseHash: input.baseHash, bufferVersion: input.bufferVersion, hash: hash(bytes) }));
    const existing = this.operations.get(key) ?? this.recovery.existing(projectKey, input.opId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new FileError('IDEMPOTENCY', '此保存编号已用于另一份内容');
      if ('result' in existing) { const receipt = await existing.result; this.requireDocument(owner, input.ref); return receipt; }
      return existing.receipt ?? { opId: input.opId, bufferVersion: input.bufferVersion, state: 'unknown', recoveryId: input.opId, message: '此前操作尚未完成恢复核对，不能重新提交' };
    }
    // Serialize physical aliases and the canonical route. A replacement changes
    // inode but must not let the next save bypass this pathname's in-flight work.
    const routeKey = `local-path:${join(lease.canonicalPath, record.relativePath)}`;
    const keys = [routeKey, record.documentKey];
    const previous = Promise.all(keys.map((k) => this.queues.get(k)?.catch(() => undefined)));
    const result = previous.then(async () => {
      this.requireDocument(owner, input.ref);
      const unresolved = keys.map((k) => this.unresolved.get(k)).find(Boolean) ?? this.recovery.blockingId(lease, record.relativePath);
      if (unresolved) return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'conflict', recoveryId: unresolved, message: '前一次保存有未解决的冲突或未知结果，请先核对恢复记录' } satisfies FileSaveReceipt;
      const current = await this.documentRequest(owner, input.ref, 'stat');
      const expected = this.requireDocument(owner, input.ref).record.revision;
      if (identityKey(current.revision) !== identityKey(expected)) return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'conflict', message: '磁盘路径已指向另一文件；本地修改仍保留' } satisfies FileSaveReceipt;
      if (current.revision.hash !== input.baseHash) return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'conflict', message: '磁盘文件已改变；本地修改仍保留' } satisfies FileSaveReceipt;
      if (!current.writable) return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'failed', message: '文件为只读；本地修改仍保留' } satisfies FileSaveReceipt;
      this.recovery.reserve(projectKey, input.opId, current.revision.size, bytes.length);
      let receipt: FileSaveReceipt;
      try {
        receipt = await this.broker.request<FileSaveReceipt>({ operation: 'save', root: lease.descriptor, relativePath: record.relativePath, expectedRevision: current.revision, recoveryRoot: this.recovery.descriptor(), protected: this.recovery.protectedIdentities(), source: { kind: lease.source, id: lease.sourceId, scope: lease.scope }, installationId: this.installationId, projectKey, fingerprint, opId: input.opId, bufferVersion: input.bufferVersion, baseHash: input.baseHash, draftHash: hash(bytes), base64: input.base64 }, { signal: lease.abort.signal, onTransaction: (identity) => this.recovery.protect(identity) });
      } catch (error) {
        const preCommitConflict = error instanceof FileError && error.code === 'CONFLICT';
        receipt = { opId: input.opId, bufferVersion: input.bufferVersion, state: preCommitConflict ? 'conflict' : 'unknown', recoveryId: input.opId, message: error instanceof Error ? error.message : String(error) };
      }
      if (receipt.state !== 'saved' && receipt.recoveryId) keys.forEach((k) => this.unresolved.set(k, receipt.recoveryId!));
      this.recovery.remember(lease, input.opId, receipt, record.relativePath);
      if (receipt.state === 'saved' && receipt.revision) { record.documentKey = `local:${identityKey(receipt.revision)}`; record.revision = receipt.revision; }
      return receipt;
    });
    this.operations.set(key, { fingerprint, filePath: join(lease.canonicalPath, record.relativePath), result }); keys.forEach((k) => this.queues.set(k, result));
    void result.finally(() => { for (const k of keys) if (this.queues.get(k) === result) this.queues.delete(k); }).catch(() => undefined);
    const receipt = await result;
    // Delivery belongs to the initiating instance, but the authoritative
    // receipt remains cached even when that instance was closed in flight.
    this.requireDocument(owner, input.ref); return receipt;
  }

  private requireDocument(owner: string, input: FileRef): { record: DocumentRecord; lease: RootLease } {
    const { record } = this.requireIssuedDocument(owner, input);
    return { record, lease: this.roots.require(owner, input) };
  }
  private requireIssuedDocument(owner: string, input: FileRef): { record: DocumentRecord; lease: RootLease } {
    const ref = fileRefSchema.parse(input), record = this.documents.get(ref.id);
    if (!record || record.owner !== owner || record.lease !== ref.lease || record.generation !== ref.generation) throw new FileError('UNTRUSTED', '文件引用已失效或不属于当前窗口');
    return { record, lease: record.issuedRoot };
  }
  private document(owner: string, lease: RootLease, result: NativeFileResult, id: string = randomUUID(), readOnly = false, attachmentHint?: FileAttachmentHint): FileDocument {
    const documentKey = `local:${identityKey(result.revision)}`;
    const previous = this.documents.get(id); readOnly ||= previous?.readOnly ?? false;
    const writable = result.writable && !readOnly;
    const name = basename(result.relativePath), sample = result.sampleBase64 ?? result.base64?.slice(0, 5464) ?? '';
    const content = classifyFile(name, Buffer.from(sample, 'base64')), hint = previous?.attachment ?? attachmentHint;
    const attachment = readOnly && hint ? { ...(hint.mimeType !== undefined ? { mimeType: hint.mimeType } : {}), textKind: content.kind === 'text' ? attachmentTextKind(name, hint.mimeType) : null } : undefined;
    this.documents.set(id, { owner, scopeKey: scopeKey(lease.scope), lease: lease.lease, issuedRoot: lease, generation: lease.generation, relativePath: result.relativePath, documentKey, revision: result.revision, content, writable, readOnly, ...(attachment ? { attachment } : {}), abort: previous?.abort ?? new AbortController() });
    return { ref: { id, lease: lease.lease, generation: lease.generation }, documentKey, name, relativePath: result.relativePath, absolutePath: join(lease.canonicalPath, result.relativePath), revision: result.revision, writable, sourceReadOnly: readOnly, content, ...(attachment ? { attachment } : {}) };
  }
  /** A missing capability remains bound to its former physical file. Reading a
   * new occupant at the same path must not silently redirect an old draft.
   * Checkpoints still use requireIssuedDocument and remain recoverable. */
  private async documentRequest(owner: string, ref: FileRef, operation: 'read' | 'stat'): Promise<NativeFileResult> {
    const { record, lease } = this.requireDocument(owner, ref);
    let result: NativeFileResult;
    try { result = await this.readRequest<NativeFileResult>(operation, lease, record.relativePath, {}, record.abort.signal); }
    catch (error) {
      if (error instanceof FileError && error.code === 'MISSING') {
        const current = this.requireIssuedDocument(owner, ref).record;
        current.missingIdentity ??= { device: current.revision.device, inode: current.revision.inode };
      }
      throw error;
    }
    const current = this.requireDocument(owner, ref).record;
    if (!current.missingIdentity && identityKey(current.revision) !== identityKey(result.revision)) {
      // An atomic external replacement may legitimately refresh a clean view.
      // If the original inode still exists under another name in this parent,
      // however, the open capability belongs to that renamed file, not the new
      // occupant of its former pathname. Inspect only this one directory.
      const revision = current.revision, parent = posix.dirname(current.relativePath);
      const listed = await this.readRequest<{ entries: FileEntry[] }>('list', lease, parent === '.' ? '' : parent, {}, record.abort.signal);
      const latest = this.requireDocument(owner, ref).record;
      if (latest.revision !== revision) throw new FileError('CHANGED', '读取期间文件版本已更新，请重试');
      if (listed.entries.some(entry => entry.relativePath !== current.relativePath && entry.identity && identityKey(entry.identity) === identityKey(revision))) {
        latest.missingIdentity = { device: revision.device, inode: revision.inode };
      }
    }
    const latest = this.requireDocument(owner, ref).record;
    if (latest.missingIdentity && identityKey(latest.missingIdentity) !== identityKey(result.revision)) throw new FileError('CHANGED', '原文件已消失或改名，此路径现在属于另一文件；本地草稿仍保留，请关闭旧标签后重新打开新文件');
    delete latest.missingIdentity;
    return result;
  }
  private async readRequest<T>(operation: string, lease: RootLease, relativePath: string, extra: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    try { return await this.broker.request<T>({ operation, root: lease.descriptor, relativePath, protected: this.recovery.protectedIdentities(), ...extra }, { signal: signal ? AbortSignal.any([lease.abort.signal, signal]) : lease.abort.signal }); }
    catch (error) {
      if (await this.roots.observeFailure(lease, error)) throw new FileError('STALE_ROOT', '原目录已失效；手工草稿仍保留，请恢复原目录后重新关联');
      this.roots.require(lease.owner, lease); throw error;
    }
  }
}
