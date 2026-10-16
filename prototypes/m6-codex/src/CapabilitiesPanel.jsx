import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

const SKILLS = [
  { key: 'db', name: '数据库诊断', source: 'WillYou 内置 · project-db-diagnostics' },
  { key: 'ssh', name: 'SSH 远程调研', source: 'WillYou 内置 · remote-password-ssh' },
];
export function CapabilitiesPanel({ project, profiles, onChange }) {
  const [profileId, setProfileId] = useState(profiles.find(p => p.isDefault)?.id || profiles[0]?.id || '');
  const [filter, setFilter] = useState(''), [scanned, setScanned] = useState(false), [upgraded, setUpgraded] = useState(false);
  const profile = profiles.find(p => p.id === profileId) || profiles[0];
  const discovered = [...SKILLS.map(s => ({ name: s.source.split(' · ')[1], kind: 'Skill', source: 'WillYou 内置', path: '/preview/skills/' + s.key + '/SKILL.md', enabled: !project || project.capabilities[s.key] })), { name: 'smartdd-project-context', kind: 'MCP', source: '项目注入', path: '/preview/runtime/mcp.json', enabled: !project || project.capabilities.mcp }];
  return <div className="capabilities-panel">
    <p className="section-description">区分“已发现”“配置有效”和“当前会话已加载”。以下版本、扫描与路径均为示例。</p>
    {SKILLS.map(s => <div className="capability-card" key={s.key}><div><strong>{s.name} <span className="tag">v{upgraded ? '1.0.1' : '1.0.0'}</span></strong><p>{s.source}</p><details><summary>版本记录</summary><code>1.0.0 · demo-sha256 · 2026-10-15</code>{upgraded && <p><code>1.0.1 · demo-update · 当前版本</code></p>}</details></div>{project ? <label className="checkbox-line"><input type="checkbox" checked={project.capabilities[s.key]} onChange={e => onChange({ ...project.capabilities, [s.key]: e.target.checked })} />启用</label> : <button className="button small secondary" disabled={upgraded} onClick={() => setUpgraded(true)}>{upgraded ? '已是最新（示例）' : '升级到 1.0.1（示例）'}</button>}</div>)}
    {project && <div className="capability-card"><div><strong>项目上下文 MCP</strong><p>提供当前项目登记的资源及配置版本。</p></div><label className="checkbox-line"><input type="checkbox" checked={project.capabilities.mcp} onChange={e => onChange({ ...project.capabilities, mcp: e.target.checked })} />启用</label></div>}
    <div className="group-heading"><select aria-label="能力扫描使用的 AI 配置" value={profile?.id || ''} onChange={e => setProfileId(e.target.value)}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="button secondary" disabled={!profile} onClick={() => setScanned(true)}><RefreshCw size={14} />重新扫描</button></div>
    {scanned && <p role="status" className="section-description">示例扫描已刷新 · {profile?.name}，未读取本机配置。</p>}
    <input aria-label="筛选 Skill 和 MCP" placeholder="按名称、类型或来源筛选…" value={filter} onChange={e => setFilter(e.target.value)} />
    <div className="table-scroll"><table className="capability-table"><thead><tr><th>名称</th><th>来源 / 路径</th><th>配置校验</th><th>会话加载</th></tr></thead><tbody>{discovered.filter(d => (d.name + d.kind + d.source).toLowerCase().includes(filter.toLowerCase())).map(d => <tr key={d.name}><td><strong>{d.name}</strong><small>{d.kind} · {profile?.runner || '—'}{!d.enabled && ' · 已停用'}</small></td><td>{d.source}<code>{d.path}</code></td><td>有效 · 示例</td><td>未核验</td></tr>)}</tbody></table></div>
  </div>;
}
