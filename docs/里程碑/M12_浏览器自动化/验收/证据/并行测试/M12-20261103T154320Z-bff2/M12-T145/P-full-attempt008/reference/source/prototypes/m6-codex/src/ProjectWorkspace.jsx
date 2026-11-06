import { useState } from 'react';
import { Archive, ArchiveRestore, ArrowUpFromLine, Check, Database, FolderOpen, Pencil, Plug, Plus, Server, SquarePen, Trash2 } from 'lucide-react';
import { Dialog, Field, PathField, SecretField, ConfirmDialog } from './PreviewUI';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { DB_VENDORS, removeResource, safeSecretFields, saveResource } from './preview-model.mjs';

const TABS = [['overview', '概览'], ['code', '代码目录'], ['database', '数据库'], ['server', '服务器'], ['apps', '应用'], ['skills', 'Skill 与 MCP'], ['tasks', '项目任务']];
const COLLECTIONS = { code: 'dirs', database: 'databases', server: 'servers' };
const NAMES = { dirs: '代码目录', databases: '数据库', servers: '服务器' };

export function ProjectEditor({ project, onClose, onSave }) {
  return <Dialog title={project ? '编辑项目信息' : '新建项目'} subtitle="管理名称、别名、说明与项目规则。" onClose={onClose} className="parity-dialog"><form onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); onSave(data); }}>
    <Field label="项目名称" name="name" defaultValue={project?.name || ''} required autoFocus />
    <Field label="项目别名" name="aliases" defaultValue={project?.aliases || ''} placeholder="多个别名用逗号分隔" />
    <Field label="项目说明"><textarea name="description" rows={3} defaultValue={project?.description || ''} /></Field>
    <PathField label="规则文件路径" name="rulesPath" defaultValue={project?.rulesPath} sample="/workspace/project/AGENTS.md" />
    {!project && <PathField label="初始代码目录（可选）" name="path" sample="/workspace/new-project" />}
    <p className="section-description">浏览按钮填入示例路径；正式应用使用本机文件选择器。</p>
    <div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary">{project ? '保存项目信息' : '创建项目'}</button></div>
  </form></Dialog>;
}

function ResourceEditor({ kind, resource, onClose, onSave }) {
  const [env, setEnv] = useState(resource?.env || 'dev');
  const [vendor, setVendor] = useState(resource?.vendor || 'mysql'), [port, setPort] = useState(resource?.port || (kind === 'databases' ? 3306 : 22));
  const [authType, setAuthType] = useState(resource?.authType || 'password'), [sudoPolicy, setSudoPolicy] = useState(resource?.sudoPolicy || 'none');
  const [tested, setTested] = useState(false);
  return <Dialog title={(resource ? '编辑' : '添加') + NAMES[kind]} subtitle="原型使用示例数据；请勿填写真实凭据。" onClose={onClose} className="parity-dialog"><form onChange={() => setTested(false)} onSubmit={e => {
    e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));
    const row = safeSecretFields({ ...resource, ...values, port: Number(values.port), available: true, isDefault: values.isDefault === 'on', defaultRoot: values.defaultRoot === 'on' }, resource);
    if (kind === 'dirs') { row.isDefault = resource?.isDefault || false; delete row.port; }
    else { row.lastTest = tested ? '示例：连接成功 · 12 ms，未连接实际资源' : null; }
    onSave(row);
  }}>
    {kind === 'dirs' ? <><PathField label="目录路径" name="path" required defaultValue={resource?.path} /><Field label="目录名称" name="label" defaultValue={resource?.label || ''} /><p className="section-description">实际应用会显示路径存在、可读写与 Git / SVN 状态。</p></> : <>
      <div className="field-grid"><Field label="环境"><input name="env" list="resource-environments" value={env} onChange={e => setEnv(e.target.value)} required /><datalist id="resource-environments"><option value="dev" /><option value="test" /><option value="prod" /></datalist></Field><Field label="资源名称" name="label" defaultValue={resource?.label || ''} /></div>
      {['prod', 'production', '生产'].includes(env.toLowerCase()) && <div className="notice warning" role="alert">生产环境：确认目标和操作范围，勿将开发配置误用于生产。</div>}
      {kind === 'databases' && <Field label="数据库类型"><select name="vendor" value={vendor} onChange={e => { if (Number(port) === DB_VENDORS[vendor][1]) setPort(DB_VENDORS[e.target.value][1]); setVendor(e.target.value); }}>{Object.entries(DB_VENDORS).map(([key, [name]]) => <option key={key} value={key}>{name}</option>)}</select></Field>}
      <div className="field-grid"><Field label="主机地址" name="host" defaultValue={resource?.host || ''} placeholder="dev.example" required /><Field label="端口"><input name="port" type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} required /></Field></div>
      {kind === 'databases' && <><Field label="数据库名" name="database" defaultValue={resource?.database || ''} />{!['mysql', 'oceanbase', 'goldendb'].includes(vendor) && <Field label="Schema" name="schema" defaultValue={resource?.schema || ''} />}</>}
      <Field label="用户名" name="username" defaultValue={resource?.username || ''} required />
      {kind === 'servers' && <Field label="认证方式"><select name="authType" value={authType} onChange={e => setAuthType(e.target.value)}><option value="password">密码</option><option value="key">私钥</option></select></Field>}
      {kind === 'databases' || authType === 'password' ? <SecretField label="密码" name="password" saved={resource?.hasPassword} /> : <><PathField label="私钥路径" name="privateKeyPath" required defaultValue={resource?.privateKeyPath} sample="/workspace/keys/demo_ed25519" /><SecretField label="私钥口令" name="passphrase" saved={resource?.hasPassphrase} /></>}
      {kind === 'databases' ? <><Field label="访问级别"><select name="accessLevel" defaultValue={resource?.accessLevel || 'readonly'}><option value="readonly">只读</option><option value="readwrite">读写</option></select></Field><label className="checkbox-line"><input type="checkbox" name="isDefault" defaultChecked={resource?.isDefault || false} />设为项目默认数据库</label></> : <>
        <Field label="sudo 策略"><select name="sudoPolicy" value={sudoPolicy} onChange={e => setSudoPolicy(e.target.value)}><option value="none">不使用 sudo</option><option value="same-as-login">使用登录密码</option><option value="separate">单独的 sudo 密码</option></select></Field>
        {sudoPolicy === 'separate' && <SecretField label="sudo 密码" name="sudoPassword" saved={resource?.hasSudoPassword} />}
        <label className="checkbox-line"><input name="defaultRoot" type="checkbox" defaultChecked={resource?.defaultRoot || false} />默认使用 root 上下文</label>
        <Field label="应用根目录" name="appRoot" defaultValue={resource?.appRoot || ''} /><Field label="日志目录" name="logsPath" defaultValue={resource?.logsPath || ''} />
      </>}
      <Field label="别名" name="aliases" defaultValue={resource?.aliases || ''} placeholder="多个别名用逗号分隔" /><Field label="备注"><textarea name="note" rows={2} defaultValue={resource?.note || ''} /></Field>
    </>}
    {tested && <p className="notice" role="status">示例：连接成功 · 12 ms。未执行真实连接。</p>}
    <div className="dialog-footer">{kind !== 'dirs' && <button type="button" className="button secondary" onClick={e => { if (e.currentTarget.form.reportValidity()) setTested(true); }}><Plug size={16} strokeWidth={1.75} aria-hidden="true" />测试连接（示例）</button>}<button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary">保存{NAMES[kind]}</button></div>
  </form></Dialog>;
}

export function ProjectWorkspace({ project, tab, profiles, tasks, onNavigate, onUpdate, onDelete, onNewTask, onOpenTask, onExport, applications, bundledApplications }) {
  const [modal, setModal] = useState(null);
  const collection = COLLECTIONS[tab];
  const update = next => onUpdate({ ...next, configVersion: Math.max(next.configVersion, project.configVersion + 1) });
  const projectTasks = tasks.filter(t => t.project === project.id);
  return <section className="project-page"><div className="project-page-inner parity-project">
    <div className="page-heading"><div><div className="title-with-icon"><FolderOpen size={25} /><h1>{project.name}</h1>{project.archived && <span className="tag">已归档</span>}</div><p>{project.description || '项目设置与资源'}</p></div><button className="button secondary" disabled={project.archived} onClick={onNewTask}><SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />新建任务</button></div>
    {project.archived && <p className="notice">项目已归档；取消归档后可创建新任务。</p>}
    <nav className="tabbar" aria-label="项目设置分类">{TABS.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => onNavigate(key)}>{label}</button>)}</nav>
    {tab === 'overview' && <><div className="settings-card project-info"><div><span>项目名称</span><strong>{project.name}</strong></div><div><span>别名</span><span>{project.aliases || '—'}</span></div><div><span>说明</span><span>{project.description || '—'}</span></div><div><span>规则文件</span><code>{project.rulesPath || '未设置'}</code></div><div><span>配置版本</span><span>v{project.configVersion}</span></div><div><span>创建时间</span><span>{project.createdAt}</span></div></div>
      <div className="project-actions"><button className="button secondary" onClick={onExport}><ArrowUpFromLine size={14} />导出项目</button><button className="button secondary" onClick={() => setModal({ type: 'edit' })}><Pencil size={14} />编辑项目信息</button><button className="button secondary" onClick={() => update({ ...project, archived: !project.archived })}>{project.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{project.archived ? '取消归档项目' : '归档项目'}</button><button className="button danger" onClick={() => setModal({ type: 'delete-project' })}><Trash2 size={14} />删除项目</button></div>
      <div className="project-summary">{[['code', FolderOpen, '代码目录', project.dirs.length], ['database', Database, '数据库', project.databases.length], ['server', Server, '服务器', project.servers.length]].map(([key, Icon, label, count]) => <button key={key} onClick={() => onNavigate(key)}><Icon size={18} /><span>{label}</span><strong>{count}</strong></button>)}</div>
    </>}
    {collection && <><div className="group-heading"><h2>{NAMES[collection]}</h2><button className="button secondary" onClick={() => setModal({ type: 'resource', collection })}><Plus size={16} strokeWidth={1.75} aria-hidden="true" />添加{NAMES[collection]}</button></div>
      {project[collection].length === 0 && <div className="empty-state"><p>尚未添加{NAMES[collection]}</p></div>}
      {[...project[collection]].sort((a, b) => Number(['prod', 'production'].includes(b.env)) - Number(['prod', 'production'].includes(a.env))).map(row => <div key={row.id} className={'resource-card ' + (['prod', 'production'].includes(row.env) ? 'production' : '')}><div className="resource-card-head"><strong>{row.label || row.database || row.path || row.host}</strong>{row.env && <span className="tag">{row.env}</span>}{row.isDefault && <span className="tag">默认</span>}{collection === 'dirs' ? <span className="tag">{row.available ? '可读写 · 示例' : '不可用 · 示例'}{row.vcs ? ' · ' + row.vcs : ''}</span> : <span className="tag">{collection === 'databases' ? DB_VENDORS[row.vendor]?.[0] : row.authType === 'key' ? '私钥' : '密码'}</span>}</div>
        <code>{collection === 'dirs' ? row.path : row.username + '@' + row.host + ':' + row.port + (row.database ? '/' + row.database : '')}</code>
        {collection !== 'dirs' && <p className="section-description">{row.lastTest || '尚未测试'}{collection === 'databases' && ' · ' + (row.accessLevel === 'readonly' ? '只读' : '读写')}</p>}
        <div className="resource-actions">{collection === 'dirs' && !row.isDefault && <button className="button small secondary" onClick={() => update(saveResource(project, collection, { ...row, isDefault: true }))}><Check size={16} strokeWidth={1.75} aria-hidden="true" />设为默认</button>}{collection !== 'dirs' && <button className="button small secondary" onClick={() => update(saveResource(project, collection, { ...row, lastTest: '示例：连接成功 · 12 ms，未连接实际资源' }))}><Plug size={16} strokeWidth={1.75} aria-hidden="true" />测试连接</button>}<button className="button small secondary" onClick={() => setModal({ type: 'resource', collection, resource: row })}><Pencil size={16} strokeWidth={1.75} aria-hidden="true" />编辑</button><button className="button small quiet-button" onClick={() => setModal({ type: 'delete-resource', collection, resource: row })}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />{collection === 'dirs' ? '移除' : '删除'}</button></div>
      </div>)}
    </>}
    {tab === 'apps' && applications}
    {tab === 'skills' && <CapabilitiesPanel project={project} profiles={profiles} bundledApplications={bundledApplications} onManageApplications={() => onNavigate('apps')} onChange={capabilities => update({ ...project, capabilities })} />}
    {tab === 'tasks' && <><div className="group-heading"><h2>项目任务</h2><span>{projectTasks.length} 项</span></div>{projectTasks.length === 0 && <p className="section-description">还没有任务，可以从右上角新建。</p>}{projectTasks.map(t => <button className="recent-row" key={t.id} onClick={() => onOpenTask(t.id)}><div><span>{t.title}</span><small>{profiles.find(p => p.id === t.profile)?.name || t.profileName || '配置已删除'}</small></div><span>{t.archived ? '已归档' : t.status === 'running' ? '运行中' : '已停止'}</span></button>)}</>}
    {modal?.type === 'edit' && <ProjectEditor project={project} onClose={() => setModal(null)} onSave={values => { update({ ...project, ...values }); setModal(null); }} />}
    {modal?.type === 'resource' && <ResourceEditor kind={modal.collection} resource={modal.resource} onClose={() => setModal(null)} onSave={value => { update(saveResource(project, modal.collection, value)); setModal(null); }} />}
    {modal?.type === 'delete-resource' && <ConfirmDialog title={'删除' + NAMES[modal.collection] + '？'} description="移除项目中的资源配置；不会删除实际文件、数据库或服务器。" secrets={modal.collection !== 'dirs'} onClose={() => setModal(null)} onConfirm={() => { update(removeResource(project, modal.collection, modal.resource.id)); setModal(null); }} />}
    {modal?.type === 'delete-project' && <ConfirmDialog title={'删除项目 ' + project.name + '？'} description="移除项目配置；任务历史保留在未关联项目中。" secrets onClose={() => setModal(null)} onConfirm={() => { onDelete(project.id); setModal(null); }} />}
  </div></section>;
}
