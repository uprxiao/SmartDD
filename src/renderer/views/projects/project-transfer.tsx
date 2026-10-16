import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowRight, Check, CircleAlert, Database, Download, FileKey2, Folder, KeyRound, LoaderCircle, LockKeyhole, Server, ShieldCheck, X } from 'lucide-react';
import { initialTransferDraft, passphraseIssue, selectTransferProfiles, transferValue, type DraftValidation, type ExportDescription, type ImportResult, type TransferCounts, type TransferDraft, type TransferPreview, type TransferReply } from '@shared/project-transfer';
import { projectTransferNavigation } from '@renderer/core/project-transfer';
import { navigation } from '@renderer/core/navigation';
import { useAiProfiles, useRefreshAiProfiles } from '@renderer/lib/hooks/useAiProfiles';
import { useRefreshProjects } from '@renderer/lib/hooks/useProjects';
import { rpc } from '@renderer/lib/ipc';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@renderer/lib/ui/dialog';
import './project-transfer.css';

type Step = 'choose' | 'unlock' | 'review' | 'export' | 'imported' | 'exported';
function Message({ children }: { children: ReactNode }) { return <div className="transfer-message is-error" role="alert"><CircleAlert size={16} /><div>{children}</div></div>; }
function Summary({ counts }: { counts: TransferCounts }) {
  return <div className="transfer-summary">{([{ Icon: Folder, label: '代码目录', value: counts.directories }, { Icon: Database, label: '数据库', value: counts.databases }, { Icon: Server, label: '服务器', value: counts.servers }, { Icon: KeyRound, label: 'AI 配置', value: counts.profiles }]).map(({ Icon, label, value }) => <div key={label}><Icon size={17} strokeWidth={1.65} /><span>{label}</span><strong>{value}</strong></div>)}</div>;
}
function Resources({ data }: { data: Pick<TransferPreview, 'resources'> }) {
  return <details className="transfer-details"><summary>查看资源与凭据范围</summary>{data.resources.map(r => <div className="transfer-resource" key={r.ref}><div><strong>{r.label}</strong><span className="tag">{r.env}</span><small>{r.detail} · {r.username}@{r.host}:{r.port}</small></div><span className="transfer-secret"><LockKeyhole size={13} />{r.credentials.join('、')}</span></div>)}<p>凭据仅显示是否包含。规则文件内容、源码、数据库数据、会话历史和 CLI 登录会话不随包迁移。</p></details>;
}

export const ProjectTransferHost = observer(function ProjectTransferHost() {
  const current = projectTransferNavigation.current;
  return current ? <ProjectTransfer key={current.key} mode={current.mode} projectId={current.projectId} returnFocus={current.returnFocus} onClose={() => projectTransferNavigation.close()} /> : null;
});

export function ProjectTransfer({ mode, projectId, returnFocus, onClose }: { mode: 'import' | 'export'; projectId?: string; returnFocus?: HTMLElement | null; onClose: () => void }) {
  const [step, setStep] = useState<Step>(mode === 'export' ? 'export' : 'choose');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false), alive = useRef(true), tokens = useRef(new Set<string>()), stage = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [pendingClose, setPendingClose] = useState(false);
  const closeFocus = useRef<HTMLElement | null>(null), discarding = useRef(false);
  const [file, setFile] = useState<{ fileToken: string; fileName: string } | null>(null);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [draft, setDraft] = useState<TransferDraft | null>(null);
  const [validation, setValidation] = useState<DraftValidation | null>(null), [validating, setValidating] = useState(false);
  const [description, setDescription] = useState<ExportDescription | null>(null);
  const [exportProfiles, setExportProfiles] = useState<string[]>([]), [emptyRefs, setEmptyRefs] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [exportResult, setExportResult] = useState<{ path: string; fileName: string } | null>(null);
  const [descriptionPending, setDescriptionPending] = useState(mode === 'export');
  const requestId = useRef(crypto.randomUUID());
  const { data: profiles = [] } = useAiProfiles();
  const refreshProjects = useRefreshProjects(), refreshProfiles = useRefreshAiProfiles();
  useEffect(() => { alive.current = true; return () => { alive.current = false; for (const token of tokens.current) void rpc.projectTransfer.dispose(token); tokens.current.clear(); }; }, []);
  useEffect(() => { stage.current?.closest('.m8-transfer')?.scrollTo({ top: 0 }); }, [step]);
  const accept = <T,>(reply: TransferReply<T>): T => {
    if (!reply.ok && reply.code === 'PREVIEW_EXPIRED') { setPreview(null); setDraft(null); setFile(null); setPassword(''); setStep('choose'); }
    return transferValue(reply);
  };
  const retain = async (token: string) => {
    if (!alive.current) { await rpc.projectTransfer.dispose(token); return false; }
    tokens.current.add(token); return true;
  };
  const operation = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError('');
    try { await fn(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '操作失败，请重试'); }
    finally { busyRef.current = false; if (alive.current) setBusy(''); }
  };
  useEffect(() => {
    if (mode !== 'export' || !projectId) return;
    let active = true; setDescriptionPending(true);
    void rpc.projectTransfer.describeExport(projectId, exportProfiles).then(reply => {
      if (active) { setDescription(transferValue(reply)); setEmptyRefs([]); setError(''); }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setDescriptionPending(false); });
    return () => { active = false; };
  }, [mode, projectId, exportProfiles]);
  useEffect(() => {
    if (!preview || !draft || step !== 'review') return;
    let active = true; setValidating(true); setValidation(null);
    const timer = setTimeout(() => { void rpc.projectTransfer.validateDraft(preview.token, draft).then(reply => {
      if (active) setValidation(accept(reply));
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setValidating(false); }); }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [preview, draft, step]);
  const close = () => {
    if (busyRef.current) return;
    if (draft || password || confirmation || exportProfiles.length || emptyRefs.length) {
      closeFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingClose(true);
    }
    else onClose();
  };
  const updateDraft = (value: TransferDraft) => { setDraft(value); setValidation(null); setValidating(true); setError(''); };
  const choose = () => operation('正在检查文件…', async () => {
    const selected = accept(await rpc.projectTransfer.chooseImport());
    if (selected && await retain(selected.fileToken)) { setFile(selected); setPreview(null); setDraft(null); setPassword(''); setStep('unlock'); }
  });
  const unlock = (event: FormEvent) => {
    event.preventDefault(); if (!file) return;
    void operation('正在解锁项目…', async () => {
      const entered = password; setPassword('');
      const result = accept(await rpc.projectTransfer.unlock(file.fileToken, entered));
      if (await retain(result.token)) { setPreview(result); setDraft(initialTransferDraft(result)); setStep('review'); }
    });
  };
  const exportFile = (event: FormEvent) => {
    event.preventDefault(); if (!projectId) return;
    const issue = passphraseIssue(password, confirmation); if (issue) { setError(issue); return; }
    void operation('正在加密并保存…', async () => {
      let result;
      try { result = accept(await rpc.projectTransfer.export({ projectId, profileIds: exportProfiles, emptyPasswordRefs: emptyRefs, passphrase: password, confirmation })); }
      catch (e) { setPassword(''); setConfirmation(''); throw e; }
      if (!alive.current) return;
      if (result) { setPassword(''); setConfirmation(''); setExportResult(result); setStep('exported'); }
    });
  };
  const imported = async (result: ImportResult) => {
    // A cache refresh failure must not turn a committed import into a retryable write.
    await Promise.allSettled([refreshProjects(), refreshProfiles()]);
    if (alive.current) { setImportResult(result); setDraft(null); setPreview(null); setStep('imported'); }
  };
  const importFile = () => {
    if (!preview || !draft || !validation?.valid || validating) return;
    void operation('正在保存项目与凭据…', async () => {
      const reply = await rpc.projectTransfer.commit(preview.token, requestId.current, draft);
      if (!reply.ok && reply.code === 'COMMIT_FAILED') {
        const recovered = accept(await rpc.projectTransfer.getResult(requestId.current));
        if (recovered) { await imported(recovered); return; }
      }
      if (!reply.ok && reply.code === 'INVALID_DRAFT') {
        // Paths or names may change after preview. Replace the stale row-level
        // status as well as showing the commit error, while keeping the draft.
        setValidation(null);
        const checked = accept(await rpc.projectTransfer.validateDraft(preview.token, draft));
        if (alive.current) setValidation(checked);
      }
      await imported(accept(reply));
    });
  };
  const title = mode === 'export' ? '导出项目' : '导入项目';
  const missing = description?.missing.filter(m => !m.allowEmpty || !emptyRefs.includes(m.ref)) ?? [];
  return <Dialog open onOpenChange={open => !open && close()}>
    <DialogContent className="m8-transfer transfer-dialog" data-testid="project-transfer-dialog" finalFocus={returnFocus ? () => returnFocus : undefined}>
      <header className="dialog-head"><DialogTitle>{title}</DialogTitle><button aria-label="关闭项目迁移" disabled={!!busy} onClick={close}><X size={18} /></button></header>
      <DialogDescription className="sr-only">WillYou 项目配置与凭据迁移</DialogDescription>
      <div ref={stage} className="transfer-stage" inert={pendingClose || undefined}>
        {busy ? <div className="transfer-loading" role="status"><LoaderCircle className="animate-spin" size={25} /><h3>{busy}</h3><p>请稍候，完成后显示结果。</p></div> : <>
          {step === 'choose' && <><div className="transfer-intro"><FileKey2 size={32} strokeWidth={1.25} /><h3>把项目带到这台电脑</h3><p>选择从 WillYou 导出的加密项目文件。<br />项目配置和凭据会一起恢复。</p></div><button className="transfer-file-choice" onClick={() => void choose()}><Folder size={18} /><span>选择项目文件<small>从这台电脑选择 .willyou 文件</small></span><ArrowRight size={17} /></button><p className="transfer-footnote">支持 .willyou 文件。会话历史与源代码不包含在文件中。</p></>}
          {step === 'unlock' && <form onSubmit={unlock}><div className="transfer-file-row"><FileKey2 size={21} /><div><strong>{file?.fileName}</strong><small>WillYou 加密项目文件</small></div><LockKeyhole size={17} /></div><label className="field">导入口令<input aria-label="导入口令" type="password" autoComplete="off" autoFocus value={password} onChange={e => setPassword(e.target.value)} required /></label><p className="transfer-footnote">口令由导出者单独提供。WillYou 无法找回遗忘的口令。</p><div className="dialog-footer"><button type="button" className="button secondary" onClick={() => void choose()}>重新选择</button><button className="button primary" disabled={!password}>解锁并预览</button></div></form>}
          {step === 'review' && preview && draft && <>
            <ol className="transfer-steps"><li><Check size={13} />选择文件</li><li><Check size={13} />解锁</li><li className="current">3<span>确认导入</span></li></ol>
            <label className="field">项目名称<input aria-label="导入后的项目名称" value={draft.name} maxLength={100} onChange={e => updateDraft({ ...draft, name: e.target.value })} aria-invalid={validation?.issues.some(i => i.field === 'name')} /></label>
            {validation?.issues.filter(i => i.field === 'name').map(i => <Message key={i.field}>{i.message}</Message>)}
            <p className="transfer-footnote">将创建独立的新项目。同名时已建议新名称，已有项目保持原样。</p>
            <Summary counts={{ ...preview.counts, profiles: draft.selectedProfileRefs.length }} />
            <div className="transfer-credential-line"><ShieldCheck size={17} /><div><strong>凭据随项目恢复</strong><p>数据库与服务器密码将加密保存到本机；私钥随包恢复时使用本机新路径。</p></div></div>
            <Resources data={preview} />
            <section className="transfer-paths"><h3>代码位置</h3><p>默认选择这台电脑上的文件夹，也可使用原代码位置。目标目录可用后才能导入。</p>
              {preview.directories.map(dir => {
                const d = draft.directories.find(d => d.ref === dir.ref)!, local = d.mode === 'local';
                const state = validation?.directories.find(d => d.ref === dir.ref), label = dir.label || '代码目录';
                const change = (changes: Partial<typeof d>) => updateDraft({ ...draft, directories: draft.directories.map(row => row.ref === dir.ref ? { ...row, ...changes } : row) });
                return <fieldset className="transfer-directory" key={dir.ref}><legend>{label} {dir.isDefault && <span className="tag">默认</span>} <span className="transfer-required">必选</span></legend><div className="transfer-directory-options">
                  <div className={'transfer-directory-option' + (local ? ' is-selected' : '')}><label className="checkbox-line"><input type="radio" name={`directory-${dir.ref}`} aria-label={`选择本机目录方式：${label}`} checked={local} onChange={() => change({ mode: 'local' })} /><span>选择本机目录</span></label><div className="field-inline transfer-directory-controls"><input placeholder="请选择本机代码文件夹" aria-label={`导入目录：${label}`} value={d.localPath ?? ''} readOnly disabled={!local} /><button className="button secondary" aria-label={`选择本机目录：${label}`} disabled={!local} onClick={() => void operation('正在选择代码目录…', async () => { const path = accept(await rpc.projectTransfer.pickDirectory(preview.token)); if (path && alive.current) change({ mode: 'local', localPath: path }); })}>选择目录</button></div></div>
                  <div className={'transfer-directory-option' + (!local ? ' is-selected' : '')}><label className="checkbox-line"><input type="radio" name={`directory-${dir.ref}`} aria-label={`使用原代码位置：${label}`} disabled={!dir.sourcePath} checked={!local} onChange={() => change({ mode: 'source' })} /><span>原代码位置：<small className="transfer-source-path">{dir.sourcePath || '文件未提供'}</small></span></label></div>
                </div><p className={'transfer-directory-status' + (state?.issue && state.path ? ' transfer-warn' : '')}>{validating ? '正在检查目录…' : state?.issue || (state?.status.available ? `目录可用${state.status.vcs ? ` · ${state.status.vcs.toUpperCase()}` : ''}` : '选择本机文件夹后继续。')}</p></fieldset>;
              })}
            </section>
            {draft.rulesPath && <section className="transfer-paths"><h3>项目规则文件</h3><div className="field"><span className="field-inline"><input aria-label="导入规则文件" value={draft.rulesPath} readOnly /><button className="button secondary" onClick={() => void operation('正在选择规则文件…', async () => { const path = accept(await rpc.projectTransfer.pickRules(preview.token)); if (path && alive.current) updateDraft({ ...draft, rulesPath: path }); })}>选择文件</button><button className="text-button" onClick={() => updateDraft({ ...draft, rulesPath: null })}>清空</button></span><small>{validation?.issues.find(i => i.field === 'rulesPath')?.message || '规则文件内容未随包迁移。'}</small></div></section>}
            <section className="transfer-paths"><h3>AI 配置<span className="transfer-profile-count">已选 {draft.selectedProfileRefs.length} / {preview.profiles.length}</span></h3><label className="checkbox-line transfer-profile-toggle"><input type="checkbox" aria-label="导入文件中的 AI 配置" checked={draft.selectedProfileRefs.length > 0} disabled={!preview.profiles.length} onChange={e => updateDraft(selectTransferProfiles(draft, preview, e.target.checked ? preview.profiles.map(p => p.ref) : []))} /><span>导入文件中的 AI 配置</span></label><p>{preview.profiles.length ? '默认不导入，可继续使用你自己的配置。勾选后可选择需要的配置，已有配置和全局默认保持不变。' : '文件未附带 AI 配置。导入后可选用你已有的配置，或在设置中添加。'}</p>
              {draft.selectedProfileRefs.length > 0 && <><div className="transfer-profile-options">{preview.profiles.map(p => {
                const selected = draft.selectedProfileRefs.includes(p.ref), executable = draft.executables.find(e => e.ref === p.ref);
                const commandStatus = validation?.profiles.find(profile => profile.ref === p.ref);
                return <div className="transfer-profile-option" key={p.ref}><label className="checkbox-line"><input type="checkbox" aria-label={`导入 AI 配置：${p.name}`} checked={selected} onChange={e => updateDraft(selectTransferProfiles(draft, preview, e.target.checked ? [...draft.selectedProfileRefs, p.ref] : draft.selectedProfileRefs.filter(ref => ref !== p.ref)))} /><span>{p.name}</span><span className="tag">{p.runner === 'codex' ? 'Codex' : 'Claude Code'}</span></label>{selected && <div className="field"><label htmlFor={`command-${p.ref}`}>本机命令</label><input id={`command-${p.ref}`} aria-label={`导入 AI 命令：${p.name}`} value={executable?.executable ?? ''} placeholder={p.runner} onChange={e => updateDraft({ ...draft, executables: draft.executables.map(row => row.ref === p.ref ? { ...row, executable: e.target.value || null } : row) })} /><small className={commandStatus && !commandStatus.available ? 'transfer-warn' : ''}>{validation?.issues.find(i => i.field === `profiles.${p.ref}`)?.message || (commandStatus?.available ? '本机命令可用，连接尚未测试。' : '命令未安装时可先导入，在设置中调整后使用。')}</small></div>}</div>;
              })}</div><div className="transfer-profile-actions"><button className="text-button" onClick={() => updateDraft(selectTransferProfiles(draft, preview, preview.profiles.map(p => p.ref)))}>全选</button><button className="text-button" onClick={() => updateDraft(selectTransferProfiles(draft, preview, []))}>全部不导入</button></div></>}
            </section>
            <div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={validating || !validation?.valid} onClick={importFile}>导入项目</button></div>
          </>}
          {step === 'export' && <form onSubmit={exportFile}>
            {description ? <><div className="transfer-file-row"><Folder size={23} /><div><strong>{description.project.name}</strong><small>配置、关联资源与凭据</small></div></div><Summary counts={description.counts} /><Resources data={description} /><div className="transfer-credential-line"><LockKeyhole size={17} /><div><strong>包含已保存的密码、私钥及令牌</strong><p>整个文件使用口令加密，接收方在 WillYou 中解锁导入。</p></div></div></> : <p role="status">正在读取项目范围…</p>}
            <details className="transfer-details"><summary>附带 AI 配置（可选）</summary><p>仅导出选中的配置及其已保存的凭据，不包含 CLI 登录会话。</p>{profiles.length ? profiles.map(p => <label className="checkbox-line" key={p.id}><input type="checkbox" aria-label={`导出 AI 配置：${p.name}`} checked={exportProfiles.includes(p.id)} onChange={e => setExportProfiles(e.target.checked ? [...exportProfiles, p.id] : exportProfiles.filter(id => id !== p.id))} /><span>{p.name}</span><span className="tag">{p.runner === 'codex' ? 'Codex' : 'Claude Code'}</span></label>) : <p>还没有可附带的 AI 配置。</p>}</details>
            {description?.missing.length ? <div className="transfer-missing"><Message>以下资源缺少凭据，请先补齐；仅确实不需要密码的资源可明确选择“无密码”。</Message>{description.missing.map(m => <div className="transfer-resource" key={`${m.ref}-${m.kind}`}><span>{m.label} · {m.kind}</span>{m.allowEmpty ? <label className="checkbox-line"><input type="checkbox" aria-label={`确认无密码：${m.label}`} checked={emptyRefs.includes(m.ref)} onChange={e => setEmptyRefs(e.target.checked ? [...emptyRefs, m.ref] : emptyRefs.filter(r => r !== m.ref))} /><span>确认此资源无密码</span></label> : <span className="transfer-warn">请补齐后重新打开导出</span>}</div>)}</div> : null}
            <div className="transfer-passwords"><label className="field">设置导出口令<input aria-label="设置导出口令" type="password" autoComplete="new-password" placeholder="至少 8 个字符" value={password} onChange={e => setPassword(e.target.value)} /></label><label className="field">再次输入口令<input aria-label="再次输入口令" type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label></div><p className="transfer-footnote">请将口令与项目文件分开交给接收方。</p>{password && passphraseIssue(password, confirmation) && <p className="transfer-warn">{passphraseIssue(password, confirmation)}</p>}
            <div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={descriptionPending || !description || !!passphraseIssue(password, confirmation) || !!missing.length}><LockKeyhole size={14} />加密并导出</button></div>
          </form>}
          {step === 'imported' && importResult && <div className="transfer-success"><div className="transfer-success-icon"><Check size={24} /></div><h3>项目已导入</h3><p>{importResult.name}</p><Summary counts={importResult.counts} /><p className="transfer-footnote">项目配置与凭据已保存。连接尚未测试，没有导入历史会话。</p>{importResult.warnings.map((text, i) => <Message key={i}>{text}</Message>)}<div className="dialog-footer"><button className="button secondary" onClick={() => { navigation.openProject(importResult.projectId); onClose(); }}>查看项目</button><button className="button primary" onClick={() => { navigation.newTask(importResult.projectId); onClose(); }}>新建任务<ArrowRight size={15} /></button></div></div>}
          {step === 'exported' && exportResult && <div className="transfer-success"><div className="transfer-success-icon"><Check size={24} /></div><h3>项目已导出</h3><p className="transfer-source-path">{exportResult.path}</p><p className="transfer-footnote">接收方在 WillYou 中选择“导入项目”，使用你单独提供的口令解锁。</p><div className="dialog-footer"><button className="button secondary" onClick={() => void operation('正在显示文件…', async () => { accept(await rpc.projectTransfer.revealExport(exportResult.path)); })}><Download size={15} />在 Finder 中显示</button><button className="button primary" onClick={onClose}>完成</button></div></div>}
          {error && <Message>{error}</Message>}
        </>}
      </div>
      <Dialog open={pendingClose} onOpenChange={setPendingClose}><DialogContent className="m8-transfer transfer-discard-dialog" finalFocus={() => discarding.current ? false : closeFocus.current} backdropProps={{ forceRender: true }}><header className="dialog-head"><DialogTitle>放弃这次{mode === 'export' ? '导出' : '导入'}？</DialogTitle><button aria-label="继续编辑" onClick={() => setPendingClose(false)}><X size={18} /></button></header><DialogDescription>尚未提交的选择和口令将被清除。继续编辑可保留当前内容。</DialogDescription><div className="dialog-footer"><button autoFocus className="button secondary" onClick={() => setPendingClose(false)}>继续编辑</button><button className="button primary" onClick={() => { discarding.current = true; onClose(); }}>放弃并关闭</button></div></DialogContent></Dialog>
    </DialogContent>
  </Dialog>;
}
