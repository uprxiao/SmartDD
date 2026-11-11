// M13 原型 P0.16（审核 review-20261111-1500 N01）：M13 预览下的任务信息、恢复任务、任务配置与会话插件弹窗。
// 都读任务创建时记录的智能体快照与插件快照（task.agent、task.pluginSnapshot），不再回查旧 AI 配置。全部为合成数据。
import React, { useState } from 'react';
import { AGENTS, LOGIN_LABEL, identityChange, launchBlock, projectBinding, resumeAgents, resumeDecision } from './m13-model.mjs';
import { Dialog, Pill } from './m13-ui.jsx';

const sourceText = a => a.source === 'login' ? `${LOGIN_LABEL[a.method || 'subscription'] || '订阅'}（CLI 自己的登录）` : a.source === 'legacy' ? '旧配置（保留原环境变量与参数）' : a.providerName || '供应商已删除';
const modelText = a => a.source === 'login' ? 'CLI 默认模型' : a.source === 'legacy' ? '按原配置' : (a.modelNames || []).map((n, i) => i === 0 ? `${n}（默认）` : n).join('、') || '—';

export function M13TaskInfo({ task, project, m13, onClose, onResume }) {
  const a = task.agent; const live = a && m13.configs.find(c => c.id === a.agentId);
  return <Dialog title="任务信息" sub={task.title} onClose={onClose} footer={<><button className="m10-button secondary" disabled={task.archived} onClick={onResume}>切换智能体恢复</button><button className="m10-button primary" onClick={onClose}>完成</button></>}>
    <dl className="m13-info compact" data-task-info>
      <dt>项目</dt><dd>{project.name}</dd>
      <dt>智能体</dt><dd>{a ? <>{a.agentName}{!live && <Pill tone="warn">已删除，恢复时需重新选择</Pill>}</> : '（旧任务，没有智能体快照）'}</dd>
      {a && <><dt>Code Agent</dt><dd>{AGENTS[a.tool] || a.tool}</dd><dt>订阅或供应商</dt><dd>{sourceText(a)}</dd><dt>模型</dt><dd>{modelText(a)}</dd>{a.runModelName && <><dt>本次模型</dt><dd data-run-model>{a.runModelName}</dd></>}</>}
      {a && <><dt>权限</dt><dd>{task.permission ? <>{task.permission.name}<code className="m13-perm-args">{task.permission.args}</code></> : '（创建时未记录）'}</dd></>}
      <dt>工作目录</dt><dd><code>{task.cwd || project.path}</code></dd>
      <dt>插件（启动时）</dt><dd>{(task.pluginSnapshot || []).map(p => `${p.name} v${p.version}`).join('、') || '无'}</dd>
      <dt>任务状态</dt><dd>{task.status === 'running' ? '运行中' : '已停止，可恢复'}</dd>
    </dl>
    <p className="m13-hint">按任务创建时的配置快照显示；恢复时沿用最后使用的模型和创建时的权限档位（不随首页之后的选择变化），所选智能体已不含该模型时提示改选（原型为合成任务，不启动真实 CLI）。</p>
  </Dialog>;
}

export function M13ResumeDialog({ task, m13, onClose, onResume, nav }) {
  const a = task.agent; const tool = a?.tool || task.runner || 'claude';
  const options = resumeAgents(m13.configs, m13.tools, tool);
  const orig = options.find(c => c.id === a?.agentId);
  const changed = orig ? identityChange(a, orig, m13.providers) : null; // 审核 2119 F01：原智能体来源已变时不预选，由用户重新选择
  const [pick, setPick] = useState(changed ? '' : orig?.id || options[0]?.id || '');
  const chosen = options.find(c => c.id === pick);
  const decision = chosen ? resumeDecision(a, chosen) : null; const lost = decision?.lost; // 审核 Q01：与实际恢复用同一判断
  const block = chosen ? launchBlock(chosen, m13.providers) : null; // 审核 Q03：恢复同样做启动预检
  return <Dialog title="恢复任务" sub={`${task.title} · 保留同一个 Code Agent（${AGENTS[tool]}）`} onClose={onClose} footer={<><button className="m10-button secondary" onClick={() => { onClose(); nav('settings/ai'); }}>管理智能体</button><button className="m10-button primary" disabled={!chosen || !!block} onClick={() => onResume(chosen, { confirmedIdentity: !!changed && chosen.id === orig?.id })}>恢复任务</button></>}>
    {a && !m13.configs.some(c => c.id === a.agentId) && <div className="m13-alert warn"><div><p>原智能体“{a.agentName}”已删除，请选择一个 {AGENTS[tool]} 智能体继续，不会悄悄换成别的账号。</p></div></div>}
    {changed && <div className="m13-alert warn" data-resume-identity><div><p>原智能体“{orig.name}”的模型来源已改变：{changed.from} → {changed.to}。请重新选择要使用的智能体；继续选它表示改用新的来源，不会悄悄换账号。</p></div></div>}
    {options.length ? <label className="m13-field"><span>智能体</span><select className="m13-select" aria-label="恢复使用的智能体" value={pick} onChange={e => setPick(e.target.value)}>{changed && <option value="" disabled>请选择智能体</option>}{options.map(c => <option key={c.id} value={c.id}>{c.name}{c.id === a?.agentId ? (changed ? `（原智能体，来源已改为 ${changed.to}）` : '（原智能体）') : ''}</option>)}</select></label>
      : <p className="m13-hint">没有可用的 {AGENTS[tool]} 智能体，请先新建。</p>}
    {lost && <p className="m13-hint m13-err">上次使用的模型 {a.runModelName || a.runModel || a.model} 不在所选智能体的模型里，将使用它的默认模型。</p>}
    {block && <div className="m13-alert warn" data-resume-block><div><p>{block.reason}。</p>{block.providerId && <button className="m13-link" onClick={() => { onClose(); nav('settings/ai/providers/' + block.providerId); }}>去填写 Key</button>}</div></div>}
    <p className="m13-hint">上次使用的模型仍在所选智能体里就沿用，否则改用它的默认模型；插件和连接按恢复时的最新状态重新加载；权限沿用创建时的档位。本页仅演示。</p>
  </Dialog>;
}

export function M13LaunchSettings({ project, dir, setDirId, profile, profiles, setProfileId, onClose, nav, setModal }) {
  return <Dialog title="任务配置" sub={project.name} onClose={onClose} footer={<><button className="m10-button secondary" onClick={() => { onClose(); project.id ? nav('project/' + project.id) : setModal({ type: 'project' }); }}>项目设置</button><button className="m10-button secondary" onClick={() => { onClose(); nav('settings/ai'); }}>管理智能体</button><button className="m10-button primary" onClick={onClose}>完成</button></>}>
    <label className="m13-field"><span>代码目录</span><select className="m13-select" value={dir?.id || ''} onChange={e => setDirId(e.target.value)}>{project.dirs.map(d => <option key={d.id} value={d.id}>{d.label || d.path}{d.isDefault ? ' · 默认' : ''}</option>)}</select></label>
    <label className="m13-field"><span>智能体</span><select className="m13-select" aria-label="任务配置智能体" value={profile?.id || ''} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <p className="m13-hint">和首页智能体下拉同一份列表、同一顺序。</p>
  </Dialog>;
}

export function M13SessionPlugins({ task, m13, onClose }) {
  const snap = task.pluginSnapshot || [];
  const state = s => { const p = m13.plugins.find(x => x.id === s.id); if (!p) return ['已卸载', 'warn']; if (!p.enabled) return ['已停用，调用会被拒绝', 'warn']; if (projectBinding(m13.bindings, p.id, task.project).disabled) return ['本项目已关闭，调用会被拒绝', 'warn']; return [p.version !== s.version ? `可用 · 已更新到 ${p.version}，下一次调用即用新版本` : '可用', 'ok']; };
  const connName = (pid, cid) => m13.plugins.find(x => x.id === pid)?.connections.find(c => c.id === cid)?.name || cid;
  return <Dialog title="会话插件" sub={task.title} onClose={onClose} footer={<button className="m10-button primary" onClick={onClose}>完成</button>}>
    {snap.length ? <div className="m13-agent-list">{snap.map(s => { const [t, tone] = state(s); return <div key={s.id} className="m13-agent-row" data-session-plugin={s.id}>
      <span className="m13-cap-main"><b>{s.name} <span className="m10-package-version">本次启动时 v{s.version}</span></b><small>{s.connections.length ? '连接：' + s.connections.map(c => connName(s.id, c.connectionId)).join('、') + '（运行中继续用这个连接）' : '无需连接'}</small></span>
      <Pill tone={tone}>{t}</Pill></div>; })}</div> : <p className="m13-hint">这个任务启动时没有可用的插件。</p>}
    <p className="m13-hint">启动时已加载的 Skill 与 MCP 在重启会话后才按最新状态变化；插件调用立即按最新状态执行。</p>
  </Dialog>;
}

// P0.17：第一次在首页选择“完全访问权限”时确认一次（需求补记 8 第 5 条），确认后记住；不替用户跳过 Claude 自身的风险警告。
export function M13FullAccessConfirm({ onClose, onConfirm }) {
  return <Dialog title="使用完全访问权限？" onClose={onClose} footer={<><button className="m10-button secondary" onClick={onClose}>取消</button><button className="m10-button primary" onClick={onConfirm}>继续使用完全访问</button></>}>
    <p className="m13-perm-warn">智能体可以不经询问修改你电脑上的任何文件、访问互联网，也可以运行任意命令。只建议在你信任当前任务和项目时使用。</p>
    <p className="m13-hint">确认后会记住，之后选择完全访问不再询问。Claude Code 第一次以完全访问启动时，终端里还会出现它自己的风险提示，需要你在终端里确认一次。</p>
  </Dialog>;
}
