import { useState } from 'react';
import { Plus, SquareTerminal, Trash2 } from 'lucide-react';
import { Dialog, Field, IconButton, PathField, SecretField } from './PreviewUI';
import { makeId } from './preview-model.mjs';

const COLORS = ['#f08b55', '#6e9ef5', '#8dbb8e', '#c59be8', '#e4bd67', '#7ac7ce'];
export function ProfileEditor({ profile, onClose, onSave, onDelete }) {
  const [runner, setRunner] = useState(profile?.runner || 'codex');
  const [name, setName] = useState(profile?.name || 'Codex'), [source, setSource] = useState(profile?.source || '本机配置');
  const [color, setColor] = useState(profile?.color || COLORS[0]);
  const [env, setEnv] = useState(profile?.env || []), [checked, setChecked] = useState(false);
  const patch = (id, values) => setEnv(old => old.map(r => r.id === id ? { ...r, ...values } : r));
  return <Dialog title={profile ? '编辑 AI 配置' : '新建 AI 配置'} subtitle="复用本机工具；高级参数和环境变量继续保留。" onClose={onClose} className="parity-dialog"><form onSubmit={e => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    const rows = env.filter(r => r.name.trim()).map(r => { if (!r.secret) return r; const mode = data.get(r.id + 'Mode'); return { id: r.id, name: r.name, secret: true, hasValue: mode === 'clear' ? false : mode === 'replace' ? Boolean(data.get(r.id)) : Boolean(r.hasValue) }; });
    if (new Set(rows.map(r => r.name.trim())).size !== rows.length) { e.currentTarget.querySelector('[name=envError]').textContent = '环境变量名不能重复'; return; }
    onSave({ name: name.trim(), runner, source, command: String(data.get('command')).trim(), args: String(data.get('args')), color, isDefault: data.get('isDefault') === 'on', env: rows });
  }}>
    <div className="field">运行器<div className="runner-choice">{['codex', 'claude'].map(r => <button type="button" className={runner === r ? 'active' : ''} key={r} onClick={() => { setRunner(r); if (!profile) setName(r === 'codex' ? 'Codex' : 'Claude Code'); setChecked(false); }}><SquareTerminal size={17} />{r === 'codex' ? 'Codex' : 'Claude Code'}</button>)}</div></div>
    <Field label="配置名称"><input required value={name} onChange={e => setName(e.target.value)} /></Field>
    <PathField key={runner} label="可执行路径" name="command" required defaultValue={profile?.runner === runner ? profile.command : runner === 'codex' ? '/opt/homebrew/bin/codex' : '/usr/local/bin/claude'} sample={runner === 'codex' ? '/opt/homebrew/bin/codex' : '/usr/local/bin/claude'} />
    <button type="button" className="button small secondary" onClick={() => setChecked(true)}>检查可执行文件（示例）</button>{checked && <p role="status" className="notice">示例：工具已找到。未检查本机文件，模型可用性尚未测试。</p>}
    <Field label="配置来源"><select value={source} onChange={e => setSource(e.target.value)}><option>本机配置</option><option>自定义配置</option></select></Field>
    <Field label="启动参数" name="args" defaultValue={profile?.args || ''} placeholder="例如 --model ..." />
    <div className="group-heading"><h2>环境变量</h2><button type="button" className="text-button" onClick={() => setEnv(old => [...old, { id: makeId(), name: '', value: '', secret: false }])}><Plus size={14} />添加变量</button></div>
    {env.length === 0 && <p className="section-description">没有额外环境变量，使用工具现有配置。</p>}
    {env.map((r, index) => <div className="env-editor" key={r.id}><div className="field-inline"><input aria-label={'变量名 ' + (index + 1)} value={r.name} required placeholder="变量名" onChange={e => patch(r.id, { name: e.target.value })} /><label className="checkbox-line"><input type="checkbox" checked={r.secret} onChange={e => patch(r.id, { secret: e.target.checked, value: '' })} />敏感</label><IconButton icon={Trash2} label={'移除变量 ' + (index + 1)} onClick={() => setEnv(old => old.filter(x => x.id !== r.id))} /></div>{r.secret ? <SecretField label="变量值" name={r.id} saved={r.hasValue} /> : <Field label="变量值"><input value={r.value || ''} onChange={e => patch(r.id, { value: e.target.value })} /></Field>}</div>)}
    <p name="envError" role="alert" className="form-error" />
    <div className="field">标识颜色<div className="color-choices">{COLORS.map(c => <button key={c} type="button" style={{ background: c }} aria-label={'颜色 ' + c} aria-pressed={color === c} onClick={() => setColor(c)} />)}</div></div>
    <label className="checkbox-line"><input type="checkbox" name="isDefault" defaultChecked={profile?.isDefault || false} />设为默认 AI 配置</label>
    <p className="section-description">本页仅保存示例状态，敏感值不写入原型数据。真实加密存储在正式应用接入。</p>
    <div className="dialog-footer">{profile && <button type="button" className="button danger" onClick={onDelete}>删除配置</button>}<button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary">保存配置</button></div>
  </form></Dialog>;
}

export function ImportProfilesDialog({ profiles, onClose, onImport }) {
  const [stage, setStage] = useState('choose'), [picked, setPicked] = useState(['CC-lab']), [created, setCreated] = useState([]);
  const candidates = ['CC-work', 'CC-deepseek', 'CC-lab'];
  return <Dialog title="导入 Claude Code 配置" subtitle=".zshrc 账号识别、预览与选择性导入。" onClose={onClose} className="parity-dialog">
    <PathField label="配置文件" name="source" defaultValue="/workspace/demo/.zshrc" sample="/workspace/demo/.zshrc" />
    <p className="section-description">原型只展示示例账号，不会读取配置文件或密钥。</p>
    {stage === 'choose' && <button className="button secondary" onClick={() => setStage('preview')}>预览导入</button>}
    {stage === 'preview' && <><div className="group-heading"><h2>发现 3 个示例账号</h2></div>{candidates.map(name => { const exists = profiles.some(p => p.name === name); return <label key={name} className="import-candidate"><input type="checkbox" disabled={exists} checked={!exists && picked.includes(name)} onChange={e => setPicked(old => e.target.checked ? [...old, name] : old.filter(n => n !== name))} /><span>{name}<small>Claude Code · API 地址已配置 · 密钥已隐藏</small></span>{exists && <span className="tag">已存在，将跳过</span>}</label>; })}<p className="notice">原配置文件可能仍含明文凭据；导入不修改来源文件。</p></>}
    {stage === 'done' && <p role="status" className="notice">已导入 {created.length} 个示例配置：{created.join('、') || '无'}。已有配置已跳过。</p>}
    <div className="dialog-footer"><button className="button secondary" onClick={onClose}>关闭</button>{stage === 'preview' && <button className="button primary" disabled={!picked.some(n => !profiles.some(p => p.name === n))} onClick={() => { const names = picked.filter(n => !profiles.some(p => p.name === n)); onImport(names.map(name => ({ id: makeId(), name, runner: 'claude', command: '/usr/local/bin/claude', source: '自定义配置', isDefault: false, color: COLORS[1], args: '', env: [{ id: makeId(), name: 'ANTHROPIC_BASE_URL', value: 'https://api.example.invalid', secret: false }, { id: makeId(), name: 'ANTHROPIC_AUTH_TOKEN', secret: true, hasValue: true }] }))); setCreated(names); setStage('done'); }}>导入所选配置</button>}</div>
  </Dialog>;
}
