// M14 原型 P0.8：右侧统一面板（照 T3 RightPanelSurfaceContent／PanelLayoutControls）。
// 顶部一排面板标签：文件／浏览器／终端／差异，“+”菜单再打开一种；右上角：最大化、底部终端抽屉、收起面板。
// 文件内容沿用 M9 文件区，浏览器内容沿用 M12 浏览器，终端为手动终端；面板只是外层容器，不改它们的内部合同。
import { useEffect, useState } from 'react';
import { FileDiff, FolderOpen, Globe, Maximize2, Minimize2, PanelBottom, PanelRight, Plus, SquareTerminal, X } from 'lucide-react';

export const SURFACES = { files: { label: '文件', icon: FolderOpen, key: 'F' }, browser: { label: '浏览器', icon: Globe, key: 'B' }, terminal: { label: '终端', icon: SquareTerminal, key: 'T' }, diff: { label: '差异', icon: FileDiff, key: 'D' } };

export function M14RightPanel({ open, active, disabled = {}, onActive, onAdd, onRemove, onClosePanel, maximized, onMaximize, drawerOpen, onToggleDrawer, children }) {
  const [menu, setMenu] = useState(false);
  const addable = Object.keys(SURFACES);
  useEffect(() => { const k = e => { if (e.target.closest?.('input,textarea,[contenteditable]')) return; const id = addable.find(s => !disabled[s] && SURFACES[s].key.toLowerCase() === e.key.toLowerCase()); if (e.key === 'Escape' && menu) setMenu(false); else if ((menu || open.length === 0) && id && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setMenu(false); onAdd(id); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [menu, onAdd, open.length, addable.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (cls, after) => <div className={cls} role="menu">{addable.map(id => { const S = SURFACES[id]; return <button key={id} role="menuitem" disabled={!!disabled[id]} title={disabled[id]} onClick={() => { setMenu(false); onAdd(id); }}><S.icon size={14} />{S.label}{open.includes(id) && <small>已打开</small>}{disabled[id] && <small>{disabled[id]}</small>}<kbd>{S.key}</kbd></button>; })}{after}</div>;
  return <aside className={'m14-rp' + (maximized ? ' max' : '')} aria-label="右侧面板">
    <div className="m14-rp-bar">
      <div className="m14-rp-tabs" role="tablist">{open.map(id => { const S = SURFACES[id]; return <div key={id} className={'m14-rp-tab' + (active === id ? ' on' : '')}>
        <button role="tab" aria-selected={active === id} onClick={() => onActive(id)}><S.icon size={14} />{S.label}</button>
        <button className="m14-rp-tab-x" aria-label={'关闭' + S.label} onClick={() => onRemove(id)}><X size={11} /></button></div>; })}</div>
      {/* “+”放在滚动的标签容器之外，菜单才不会被裁掉 */}
      <div className="m14-rp-add"><button aria-label="打开面板" aria-expanded={menu} title="打开面板" onClick={() => setMenu(!menu)}><Plus size={15} /></button>
        {menu && <><button className="m14-fixed-scrim" style={{ background: 'transparent' }} aria-label="关闭菜单" onClick={() => setMenu(false)} />{list('m14-rp-menu')}</>}</div>
      <span className="m14-rp-push" />
      <div className="m14-rp-ctl">
        <button title={maximized ? '还原面板' : '最大化面板'} aria-label={maximized ? '还原面板' : '最大化面板'} onClick={onMaximize}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button title="底部终端抽屉（⌃`）" aria-label="底部终端抽屉" aria-pressed={drawerOpen} className={drawerOpen ? 'on' : ''} onClick={onToggleDrawer}><PanelBottom size={15} /></button>
        <button title="收起右侧面板" aria-label="收起右侧面板" className="on" onClick={onClosePanel}><PanelRight size={15} /></button>
      </div>
    </div>
    <div className="m14-rp-body">
      {open.length === 0 && <div className="m14-rp-empty"><b>打开面板</b>{list('m14-rp-empty-list')}</div>}
      {open.map(id => <div key={id} className="m14-rp-surface" hidden={active !== id}>{children[id]}</div>)}
    </div>
  </aside>;
}

// 浏览器面板内的网页标签（M12 的网页标签从文件区标签条移到这里）
export function WebTabs({ tabs, activeId, onSelect, onClose, onNew }) {
  return <div className="m14-webtabs">{tabs.map(t => <div key={t.id} className={'m14-webtab' + (t.id === activeId ? ' on' : '')}><button onClick={() => onSelect(t.id)} title={t.url}><Globe size={12} /><span>{t.title}</span>{t.marked && <i className="m14-webtab-dot" title="Agent 正在操作" />}</button><button aria-label={'关闭网页 ' + t.title} onClick={() => onClose(t.id)}><X size={11} /></button></div>)}
    <button className="m14-webtab-new" aria-label="新建网页标签" title="新建网页标签（⇧⌘B）" onClick={onNew}><Plus size={13} /></button></div>;
}

// 差异面板（T3 DiffPanel 的位置；内容复用 M9 差异展示能力，此处为示意）
export function DiffSurface({ diff, onOpenFile, readOnly = false }) {
  if (!diff) return <div className="m14-diff-empty-state"><FileDiff size={22} /><p>还没有选择要查看的改动</p><small>在任务里点改动卡片的“查看差异”或某个文件，会在这里打开。只读查看，回退请用 git／svn 命令。</small></div>;
  return <RoundDiff key={diff.key ?? diff.turnId} initial={diff} onOpenFile={readOnly ? undefined : onOpenFile} />;
}

function RoundDiff({ initial, onOpenFile }) {
  const [turnId, setTurn] = useState(initial.turnId);
  const [sel, setSel] = useState(initial.path);
  const revision = initial.revisions?.find(turn => turn.id === turnId);
  const diff = revision ?? initial;
  const rounds = initial.revisions?.length > 0 && <label className="m14-round-selector">轮次
    <select aria-label="差异轮次" value={turnId || ''} onChange={event => { setTurn(event.target.value); setSel(null); }}>
      {initial.revisions.map(round => <option key={round.id} value={round.id}>{round.title}</option>)}
    </select>
  </label>;
  if (!diff.files.length) return <div className="m14-diffsurf"><div className="m14-diffsurf-head">{rounds}</div>
    <div className="m14-diff-empty-state"><FileDiff size={22} /><p>{diff.status === 'reclaimed' ? '快照已清理（空间回收）' : diff.status === 'storage-full' ? '影子库空间已满' : '本轮没有可显示的差异'}</p></div>
  </div>;
  const f = diff.files.find(x => x.path === sel) || diff.files[0];
  const add = diff.files.reduce((n, x) => n + x.add, 0), del = diff.files.reduce((n, x) => n + x.del, 0);
  return <div className="m14-diffsurf">
    <div className="m14-diffsurf-head">{rounds || <b>本轮改动</b>}<span>{diff.files.length} 个文件 <i className="add">+{add}</i> <i className="del">−{del}</i></span><small>只读 · 回退请用 git／svn 命令</small></div>
    <div className="m14-diffsurf-main">
      <ul className="m14-diffsurf-files">{diff.files.map(x => <li key={x.path}><button className={x.path === f.path ? 'on' : ''} onClick={() => setSel(x.path)}><span className={'m14-fstatus s-' + x.status}>{x.status}</span><span className="m14-fpath">{x.path}</span>{x.external && <span className="m14-ext-tag">外部修改</span>}<span className="m14-fmeta">{x.binary ? '二进制' : <><i className="add">+{x.add}</i> <i className="del">−{x.del}</i></>}</span></button></li>)}</ul>
      <div className="m14-diffsurf-view">
        <div className="m14-diffsurf-file"><span>{f.path}</span>{onOpenFile && !f.binary && <button onClick={() => onOpenFile(f.path)}>在文件中打开</button>}</div>
        {f.binary ? <div className="m14-diff-empty">二进制文件：182 KB → 186 KB，不提供内容预览。</div>
          : <div className="m14-diff">{f.diff.map(([k, t], i) => <div key={i} className={'m14-dl ' + (k === '+' ? 'add' : k === '-' ? 'del' : '')}><span>{k}</span><code>{t}</code></div>)}</div>}
        <p className="m14-diffsurf-note">差异展示复用 M9 差异组件（示意）。</p>
      </div>
    </div>
  </div>;
}
