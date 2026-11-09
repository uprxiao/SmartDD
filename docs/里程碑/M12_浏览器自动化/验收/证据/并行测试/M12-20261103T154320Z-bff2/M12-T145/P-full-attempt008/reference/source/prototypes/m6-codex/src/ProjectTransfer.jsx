import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleAlert, Database, FileKey2, Folder, KeyRound, LoaderCircle, LockKeyhole, Server, ShieldCheck } from 'lucide-react';
import { Dialog } from './PreviewUI';
import { makeId, makeProject } from './preview-model.mjs';
import './transfer.css';

// M8 review prototype only. Never reads real files, credentials or production storage.
export const DEMO_PASSPHRASE = 'willyou-demo-2026';
const SCENARIOS = [['normal', '正常流程'], ['missing-path', '目录需要调整'], ['no-directories', '文件未附带代码目录'], ['rules-path', '规则文件待调整'], ['cli-missing', '附带 AI 配置待调整'], ['damaged', '文件损坏'], ['future', '文件版本过新'], ['storage', '安全存储不可用'], ['write-failed', '写入失败与重试'], ['missing-credential', '导出缺少凭据']];
const copy = x => structuredClone(x);
const makeSample = () => {
  const p = makeProject({ id: 'ais-package', name: 'AIS', path: '/Users/demo/Projects/AIS', description: 'AI 应用平台', aliases: 'AIS, 开发平台' }, true);
  p.databases = ['开发数据库', '生产数据库', '共享数据库'].map((label, i) => ({ ...p.databases[0], id: makeId(), label, env: ['dev', 'prod', 'shared'][i], vendor: i === 1 ? 'opengauss' : 'mysql', port: i === 1 ? 5432 : 3306, host: ['dev-db.example', 'prod-db.example', 'shared-db.example'][i], database: i === 2 ? 'shared_demo' : 'ais_demo', isDefault: i === 0 }));
  p.servers = ['研发服务器', '生产服务器'].map((label, i) => ({ ...p.servers[0], id: makeId(), label, host: i ? 'prod-server.example' : 'dev-server.example', env: i ? 'prod' : 'dev', defaultRoot: Boolean(i), sudoPolicy: i ? 'same-as-login' : 'none' }));
  return p;
};
function uniqueName(base, projects) {
  const used = n => projects.some(p => !p.archived && p.name.trim().toLowerCase() === n.toLowerCase());
  if (!used(base)) return base;
  let n = 1, name;
  do { const suffix = `（导入${n === 1 ? '' : ' ' + n}）`; name = base.slice(0, 100 - suffix.length) + suffix; n++; } while (used(name));
  return name;
}
function Summary({ project, profileCount = 0 }) {
  return <div className="transfer-summary">{[[Folder, '代码目录', project.dirs.length], [Database, '数据库', project.databases.length], [Server, '服务器', project.servers.length], [KeyRound, 'AI 配置', profileCount]].map(([Icon, name, count]) => <div key={name}><Icon size={17} strokeWidth={1.65} /><span>{name}</span><strong>{count}</strong></div>)}</div>;
}
function Message({ children, danger = false }) { return <div className={'transfer-message ' + (danger ? 'is-error' : '')} role={danger ? 'alert' : 'status'}><CircleAlert size={16} /><div>{children}</div></div>; }
function ResourceRows({ project }) {
  return <details className="transfer-details"><summary>查看资源与凭据范围</summary>{[...project.databases.map(r => ({ ...r, kind: '数据库' })), ...project.servers.map(r => ({ ...r, kind: '服务器' }))].map(r => <div className="transfer-resource" key={r.id}><div><strong>{r.label}</strong><span className="tag">{r.env}</span><small>{r.kind} · {r.username}@{r.host}:{r.port}</small></div><span className="transfer-secret"><LockKeyhole size={13} />{r.authType === 'key' ? '私钥及口令已包含' : '密码已包含'}</span></div>)}<p>凭据仅显示是否包含。规则文件内容、源码、数据库数据、会话历史和 CLI 登录会话不随包迁移。</p></details>;
}

export function ProjectTransfer({ mode, project, projects, profiles, lastPackage, onExport, onImport, onClose, onOpenProject, onStartTask, onOpenApplications }) {
  const [scenario, setScenario] = useState('normal');
  const [step, setStep] = useState(mode === 'export' ? 'export' : 'choose');
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [selectedProfiles, setSelectedProfiles] = useState([]);
  const [selectedImportProfiles, setSelectedImportProfiles] = useState([]);
  const [importedProfileCount, setImportedProfileCount] = useState(0);
  const [emptyPasswordConfirmed, setEmptyPasswordConfirmed] = useState(false);
  const [error, setError] = useState(''), [result, setResult] = useState(null);
  const [pendingClose, setPendingClose] = useState(false), [retryReady, setRetryReady] = useState(false);
  const [source, setSource] = useState(null), [draft, setDraft] = useState(null);
  const timer = useRef(null), stageRef = useRef(null);
  const busy = ['reading', 'unlocking', 'exporting', 'importing'].includes(step);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const dialog = stageRef.current?.closest('dialog');
    if (dialog) {
      dialog.querySelector('.dialog-head button')?.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    }
  }, [step]);
  const later = (busyStep, action) => { setError(''); setStep(busyStep); timer.current = setTimeout(action, 650); };
  const close = () => {
    if (busy) return;
    if (['review', 'export', 'unlock'].includes(step) && (password || confirm || selectedProfiles.length || draft)) setPendingClose(true);
    else onClose();
  };
  const reset = next => { clearTimeout(timer.current); setScenario(next); setStep(mode === 'export' ? 'export' : 'choose'); setPassword(''); setConfirm(''); setDraft(null); setSource(null); setError(''); setRetryReady(false); setPendingClose(false); setEmptyPasswordConfirmed(false); setSelectedProfiles([]); setSelectedImportProfiles([]); };
  const selectFile = () => later('reading', () => {
    if (scenario === 'damaged' || scenario === 'future') { setError(scenario === 'damaged' ? '无法读取这个项目文件，请重新选择完整的导出文件。' : '这个文件来自更新的格式版本，请先更新 WillYou。'); setStep('choose'); return; }
    const sample = makeSample();
    if (scenario === 'no-directories') { sample.dirs = []; sample.path = ''; }
    if (scenario === 'rules-path') sample.rulesPath = '/Users/demo/Projects/AIS/AGENTS.md';
    const sampleProfiles = ['codex', 'claude'].map(runner => ({ id: 'sample-' + runner, name: (runner === 'codex' ? 'Codex' : 'Claude Code') + ' 项目配置', runner, command: '/Users/demo/bin/' + runner, source: '导入配置', available: false, isDefault: false }));
    setSource(lastPackage || { project: sample, profiles: sampleProfiles, passphrase: DEMO_PASSPHRASE }); setStep('unlock');
  });
  const unlock = e => {
    e.preventDefault();
    later('unlocking', () => {
      if (password !== source.passphrase) { setError('口令不正确，或文件已经损坏。请核对后重试。'); setPassword(''); setStep('unlock'); return; }
      const p = copy(source.project);
      p.name = uniqueName(p.name, projects);
      p.rulesReady = !p.rulesPath;
      const sourceDirs = p.dirs.length ? p.dirs : [{ id: makeId(), label: '主目录', path: '', isDefault: true }];
      p.dirs = sourceDirs.map(d => ({ ...d, sourcePath: d.path, pathMode: 'local', localPath: '', localAvailable: false, path: '', available: false }));
      setSource({ ...source, profiles: source.profiles.map(profile => ({ ...profile, available: false })) });
      setSelectedImportProfiles([]); setDraft(p); setPassword(''); setStep('review');
    });
  };
  const exportFile = e => {
    e.preventDefault();
    if ([...password].length < 8 || new TextEncoder().encode(password).length > 1024) return setError('导出口令至少 8 个字符，UTF-8 长度不超过 1024 字节。');
    if (password !== confirm) return setError('两次输入的口令不一致。');
    later('exporting', () => {
      if (scenario === 'missing-credential' && !emptyPasswordConfirmed) { setError('开发数据库缺少密码。请补齐后重新导出。'); setStep('export'); return; }
      if (scenario === 'storage') { setError('系统安全存储当前不可用，无法读取已保存的凭据。请恢复后重试。'); setStep('export'); return; }
      const p = { project: copy(project), profiles: profiles.filter(p => selectedProfiles.includes(p.id)).map(copy), passphrase: password };
      onExport(p); setPassword(''); setConfirm(''); setResult(p); setStep('exported');
    });
  };
  const clash = draft && projects.some(p => !p.archived && p.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
  const invalidName = draft && (!draft.name.trim() || draft.name.trim().length > 100 || clash);
  const pathOwner = path => path && projects.find(p => !p.archived && p.dirs.some(d => d.path.replace(/\/$/, '') === path.replace(/\/$/, '')));
  const pathConflict = draft?.dirs.some((d, i) => pathOwner(d.path) || draft.dirs.some((x, j) => i !== j && x.path.replace(/\/$/, '') === d.path.replace(/\/$/, '')));
  const invalidPaths = !draft?.dirs.length || draft.dirs.some(d => !d.available || !d.path.startsWith('/') || d.path.length > 1024) || pathConflict;
  const invalidRules = draft?.rulesPath && !draft.rulesReady;
  const setDirectoryMode = (row, pathMode) => {
    const path = pathMode === 'source' ? row.sourcePath : (row.localPath || '');
    const available = pathMode === 'source' ? Boolean(path && scenario !== 'missing-path') : Boolean(row.localAvailable);
    setDraft({ ...draft, dirs: draft.dirs.map(d => d.id === row.id ? { ...d, pathMode, path, available } : d) });
  };
  const chooseDirectory = row => {
    const unavailable = scenario === 'missing-path' && !row.localPath;
    let path = unavailable ? '/Volumes/未挂载/AIS-M8' : '/workspace/AIS-M8', i = 2;
    while (pathOwner(path) || draft.dirs.some(d => d.id !== row.id && d.path === path)) path = '/workspace/AIS-M8-' + i++;
    setDraft({ ...draft, dirs: draft.dirs.map(d => d.id === row.id ? { ...d, pathMode: 'local', localPath: path, localAvailable: !unavailable, path, available: !unavailable } : d) });
  };
  const importFile = () => {
    if (invalidName || invalidPaths || invalidRules) return;
    later('importing', () => {
      if (scenario === 'storage' && !retryReady) { setError('系统安全存储不可用，项目尚未导入。恢复后可重试。'); setStep('review'); return; }
      if (scenario === 'write-failed' && !retryReady) { setError('保存失败，本次新增内容已回滚。已有项目未受影响，可以重试。'); setStep('review'); return; }
      const value = { ...draft, id: makeId(), name: draft.name.trim(), configVersion: 1, archived: false, createdAt: '2026-10-16', path: draft.dirs.find(d => d.isDefault)?.path || '', dirs: draft.dirs.map(({ sourcePath, pathMode, localPath, localAvailable, ...d }) => ({ ...d, id: makeId() })), databases: draft.databases.map(d => ({ ...d, id: makeId(), lastTest: null })), servers: draft.servers.map(s => ({ ...s, id: makeId(), lastTest: null })) };
      const chosenProfiles = source.profiles.filter(p => selectedImportProfiles.includes(p.id));
      onImport(value, chosenProfiles); setImportedProfileCount(chosenProfiles.length); setResult(value); setDraft(null); setSource(null); setStep('imported');
    });
  };
  const title = mode === 'export' ? '导出项目' : '导入项目';
  return <><Dialog title={title} onClose={close} className="transfer-dialog">
    <div className="transfer-preview-controls"><span>M8 · 交互预览</span><label>场景<select aria-label="M8 预览场景" value={scenario} disabled={busy} onChange={e => reset(e.target.value)}>{SCENARIOS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><small>仅示例数据 · 刷新重置</small></div>
    <div ref={stageRef} tabIndex={-1} className="transfer-stage" aria-live="polite" inert={pendingClose || undefined}>
    {busy && <div className="transfer-loading"><LoaderCircle className="spin" size={25} /><h3>{({ reading: '正在检查文件…', unlocking: '正在解锁项目…', importing: '正在保存项目与凭据…', exporting: '正在加密并保存…' })[step]}</h3><p>演示状态，不读写实际项目。</p></div>}
    {step === 'choose' && <><div className="transfer-intro"><FileKey2 size={32} strokeWidth={1.25} /><h3>把项目带到这台电脑</h3><p>选择从 WillYou 导出的加密项目文件。<br />项目配置和凭据会一起恢复。</p></div><button className="transfer-file-choice" onClick={selectFile}><Folder size={18} /><span>选择项目文件<small>{lastPackage ? '使用刚才导出的示例文件' : '演示文件：AIS-M8.willyou'}</small></span><ArrowRight size={17} /></button>{error && <Message danger>{error}</Message>}<p className="transfer-footnote">支持 .willyou 文件。会话历史与源代码不包含在文件中。</p></>}
    {step === 'unlock' && <form onSubmit={unlock}><div className="transfer-file-row"><FileKey2 size={21} /><div><strong>{source.project.name}-M8.willyou</strong><small>WillYou 加密项目文件</small></div><LockKeyhole size={17} /></div><label className="field">导入口令<input aria-label="导入口令" type="password" autoComplete="off" autoFocus value={password} onChange={e => setPassword(e.target.value)} required /></label><p className="transfer-footnote">口令由导出者单独提供。WillYou 无法找回遗忘的口令。</p><p className="transfer-simulation">{lastPackage ? '使用你刚才在原型中设置的口令。' : `原型示例口令：${DEMO_PASSPHRASE}`}</p>{error && <Message danger>{error}</Message>}<div className="dialog-footer"><button type="button" className="button secondary" onClick={() => { setStep('choose'); setPassword(''); setError(''); }}>重新选择</button><button className="button primary" disabled={!password}>解锁并预览</button></div></form>}
    {step === 'review' && <><ol className="transfer-steps"><li className="done"><Check size={13} />选择文件</li><li className="done"><Check size={13} />解锁</li><li className="current">3<span>确认导入</span></li></ol><label className="field">项目名称<input aria-label="导入后的项目名称" value={draft.name} maxLength={100} onChange={e => { setDraft({ ...draft, name: e.target.value }); setError(''); }} aria-invalid={Boolean(invalidName)} /></label>{invalidName && <Message danger>{clash ? '已有同名项目，请换一个名称。' : '请填写 1–100 个字符的项目名称。'}</Message>}<p className="transfer-footnote">将创建独立的新项目。同名时已建议新名称，已有项目保持原样。</p><Summary project={draft} profileCount={selectedImportProfiles.length} /><div className="transfer-credential-line"><ShieldCheck size={17} /><div><strong>凭据随项目恢复</strong><p>数据库与服务器密码将加密保存到本机；私钥随包恢复时使用本机新路径。</p></div></div><ResourceRows project={draft} />
      <section className="transfer-paths"><h3>代码位置</h3><p>默认选择这台电脑上的文件夹，也可使用原代码位置。目标目录可用后才能导入。</p>{draft.dirs.map(d => {
        const local = d.pathMode !== 'source';
        const label = d.label || '代码目录';
        return <fieldset key={d.id} className="transfer-directory"><legend>{label} {d.isDefault && <span className="tag">默认</span>} <span className="transfer-required">必选</span></legend>
          <div className="transfer-directory-options">
            <div className={'transfer-directory-option' + (local ? ' is-selected' : '')}>
              <label className="checkbox-line"><input type="radio" name={'directory-mode-' + d.id} aria-label={'选择本机目录方式：' + label} checked={local} onChange={() => setDirectoryMode(d, 'local')} /><span>选择本机目录</span></label>
              <div className="field-inline transfer-directory-controls"><input placeholder="请选择本机代码文件夹" aria-label={'导入目录：' + label} value={d.localPath || (local ? d.path : '')} readOnly disabled={!local} /><button aria-label={'选择本机目录：' + label} className="button secondary" disabled={!local} onClick={() => chooseDirectory(d)}>选择目录</button></div>
            </div>
            <div className={'transfer-directory-option' + (!local ? ' is-selected' : '')}>
              <label className="checkbox-line"><input type="radio" name={'directory-mode-' + d.id} aria-label={'使用原代码位置：' + label} checked={!local} disabled={!d.sourcePath} onChange={() => setDirectoryMode(d, 'source')} /><span>原代码位置：<small className="transfer-source-path">{d.sourcePath || '文件未提供'}</small></span></label>
            </div>
          </div>
          <p className={'transfer-directory-status' + (d.path && !d.available ? ' transfer-warn' : '')}>{!d.path ? '选择本机文件夹后继续。' : d.available ? (local ? '本机目录可用 · 示例检查' : '原代码位置在本机可用 · 示例检查') : '此目录不可用，请改选可用的本机文件夹后继续。'}</p>
        </fieldset>;
      })}</section>
      {invalidPaths && draft.dirs.some(d => d.path) && <Message danger>{pathConflict ? '目录重复或已被其他项目占用，请选择另一个目录。' : '请为每个代码位置选择可用的本机文件夹后再导入。'}</Message>}
      {draft.rulesPath && <section className="transfer-paths"><h3>项目规则文件</h3><label className="field"><span className="field-inline"><input aria-label="导入规则文件" value={draft.rulesPath} onChange={e => setDraft({ ...draft, rulesPath: e.target.value, rulesReady: false })} /><button className="button secondary" onClick={() => setDraft({ ...draft, rulesPath: '/workspace/AIS-M8/AGENTS.md', rulesReady: true })}>选择文件</button><button className="text-button" onClick={() => setDraft({ ...draft, rulesPath: '', rulesReady: true })}>清空</button></span><small>{draft.rulesReady ? '规则文件可读 · 示例' : '请重新选择本机文件或清空引用；文件内容未随包迁移。'}</small></label></section>}
      <section className="transfer-paths">
        <h3>AI 配置<span className="transfer-profile-count">已选 {selectedImportProfiles.length} / {source.profiles.length}</span></h3>
        <label className="checkbox-line transfer-profile-toggle"><input type="checkbox" aria-label="导入文件中的 AI 配置" checked={selectedImportProfiles.length > 0} disabled={!source.profiles.length} onChange={e => setSelectedImportProfiles(e.target.checked ? source.profiles.map(p => p.id) : [])} /><span>导入文件中的 AI 配置</span></label>
        <p>{source.profiles.length ? '默认不导入，可继续使用你自己的配置。勾选后可选择需要的配置，已有配置和全局默认保持不变。' : '文件未附带 AI 配置。导入后可选用你已有的配置，或在设置中添加。'}</p>
        {selectedImportProfiles.length > 0 && <><div className="transfer-profile-options">{source.profiles.map(p => {
          const selected = selectedImportProfiles.includes(p.id);
          return <div className="transfer-profile-option" key={p.id}>
            <label className="checkbox-line"><input type="checkbox" aria-label={'导入 AI 配置：' + p.name} checked={selected} onChange={e => setSelectedImportProfiles(e.target.checked ? [...selectedImportProfiles, p.id] : selectedImportProfiles.filter(id => id !== p.id))} /><span>{p.name}</span><span className="tag">{p.runner === 'codex' ? 'Codex' : 'Claude Code'}</span></label>
            {selected && <div className="field"><label htmlFor={'import-command-' + p.id}>本机命令</label><span className="field-inline"><input id={'import-command-' + p.id} aria-label={'导入 AI 命令：' + p.name} value={p.command || ''} onChange={e => setSource({ ...source, profiles: source.profiles.map(x => x.id === p.id ? { ...x, command: e.target.value, available: false } : x) })} /><button className="button secondary" aria-label={'检测本机：' + p.name} onClick={() => setSource({ ...source, profiles: source.profiles.map(x => x.id === p.id ? { ...x, command: '/opt/homebrew/bin/' + (p.runner === 'codex' ? 'codex' : 'claude'), available: true } : x) })}>检测本机</button></span><small>{p.available === false ? 'CLI 尚未就绪，可先保存配置，配置好后再使用。' : '命令可用 · 示例；联网测试需另行触发。'}</small></div>}
          </div>;
        })}</div>
        <div className="transfer-profile-actions"><button className="text-button" onClick={() => setSelectedImportProfiles(source.profiles.map(p => p.id))}>全选</button><button className="text-button" onClick={() => setSelectedImportProfiles([])}>全部不导入</button></div>
        <p>CLI 登录状态不随文件迁移。选中的配置会另存为新配置，未选中的配置及凭据不会导入。</p></>}
      </section>
      {error && <Message danger>{error}</Message>}{error && ['storage', 'write-failed'].includes(scenario) && <button className="text-button transfer-retry" onClick={() => { setRetryReady(true); setError(''); }}>模拟问题已解决</button>}
      <div className="dialog-footer"><button className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={Boolean(invalidName || invalidPaths || invalidRules)} onClick={importFile}>导入项目</button></div></>}
    {step === 'export' && <form onSubmit={exportFile}><div className="transfer-file-row"><Folder size={23} /><div><strong>{project.name}</strong><small>配置、关联资源与凭据</small></div></div><Summary project={project} profileCount={selectedProfiles.length} /><ResourceRows project={project} /><p className="transfer-footnote">应用配置、应用连接与凭据、邮件数据、草稿和发送记录不包含在项目文件中；在目标电脑重新选用本机连接。</p><div className="transfer-credential-line"><LockKeyhole size={17} /><div><strong>包含已保存的密码、私钥及令牌</strong><p>整个文件使用口令加密，接收方在 WillYou 中解锁导入。</p></div></div><details className="transfer-details"><summary>附带 AI 配置（可选）</summary><p>选择希望随项目分享的配置。不会导出 CLI 的本机登录会话。</p>{profiles.map(p => <label className="checkbox-line" key={p.id}><input type="checkbox" checked={selectedProfiles.includes(p.id)} onChange={e => setSelectedProfiles(e.target.checked ? [...selectedProfiles, p.id] : selectedProfiles.filter(x => x !== p.id))} />{p.name}<span className="tag">{p.runner === 'claude' ? 'Claude Code' : 'Codex'}</span></label>)}</details><div className="transfer-passwords"><label className="field">设置导出口令<input aria-label="设置导出口令" type="password" autoComplete="new-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="至少 8 个字符" required /></label><label className="field">再次输入口令<input aria-label="再次输入口令" type="password" autoComplete="new-password" value={confirm} onChange={e => { setConfirm(e.target.value); setError(''); }} required /></label></div><p className="transfer-footnote">请将口令与项目文件分开交给接收方。</p><p className="transfer-simulation">原型请使用示例口令，不填写真实密码。保存文件与加密仅演示。</p>{error && <Message danger>{error}</Message>}{scenario === 'missing-credential' && error && <label className="checkbox-line"><input type="checkbox" checked={emptyPasswordConfirmed} onChange={e => setEmptyPasswordConfirmed(e.target.checked)} />确认开发数据库使用空密码（仅演示）</label>}<div className="dialog-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={!password || !confirm}><LockKeyhole size={14} />加密并导出</button></div></form>}
    {step === 'exported' && <><div className="transfer-intro transfer-success"><span className="transfer-success-icon"><Check size={26} /></span><h3>项目已导出</h3><p>{result.project.name}-M8.willyou</p></div><Message>将这个文件交给使用 WillYou 的接收方，并单独提供导入口令。</Message><p className="transfer-simulation">这是原型演示，未在磁盘写入文件。</p><div className="dialog-footer"><button className="button secondary" onClick={onClose}>完成</button><button className="button primary" onClick={() => { onClose(); onOpenProject('import'); }}>演示接收方导入<ArrowRight size={14} /></button></div></>}
    {step === 'imported' && <><div className="transfer-intro transfer-success"><span className="transfer-success-icon"><Check size={26} /></span><h3>项目已导入</h3><p>{result.name}</p></div><Summary project={result} profileCount={importedProfileCount} /><Message>应用配置与数据不随项目导入。请在项目应用中明确选择这台电脑已有的连接；缺少时再添加，不自动匹配同名账号。</Message><div className="transfer-credential-line"><ShieldCheck size={17} /><div><strong>资源与凭据已恢复</strong><p>连接尚未测试；可在项目中检查数据库和服务器。</p></div></div>{result.dirs.some(d => !d.available) && <Message>代码目录尚未就绪，请先调整目录再创建任务。</Message>}<p className="transfer-simulation">仅保存在原型内存中，刷新后重置。正式版本需要持久化验收。</p><div className="dialog-footer"><button className="button secondary" onClick={() => onOpenProject(result.id)}>查看项目</button>{onOpenApplications && <button className="button secondary" onClick={() => onOpenApplications(result.id)}>配置项目应用</button>}<button className="button primary" disabled={!result.dirs.some(d => d.available)} onClick={() => onStartTask(result.id)}>新建任务<ArrowRight size={14} /></button></div></>}
    </div>
  </Dialog>
  {pendingClose && <Dialog title={'放弃这次' + (mode === 'export' ? '导出' : '导入') + '？'} className="transfer-discard-dialog" onClose={() => setPendingClose(false)}><p>尚未提交的选择和口令将被清除。继续编辑可保留当前内容。</p><div className="dialog-footer"><button className="button secondary" autoFocus onClick={() => setPendingClose(false)}>继续编辑</button><button className="button primary" onClick={onClose}>放弃并关闭</button></div></Dialog>}
  </>;
}
