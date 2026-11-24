import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { MenuItem } from './composer-menu';

/** 输入框选用菜单（/命令、@文件、$Skill）；方向键选择，Enter／Tab 选用，Esc 关闭。 */
export function ComposerMenu({ items, index, onPick, skills, empty }: { items: MenuItem[]; index: number; onPick: (i: MenuItem) => void; skills: boolean; empty?: string }) {
  const menu = useRef<HTMLDivElement>(null);
  const selected = items[index]?.key;
  useEffect(() => {
    const list = menu.current;
    const active = list?.children[index] as HTMLElement | undefined;
    if (!skills || !list || !active) return;
    const top = active.offsetTop, bottom = top + active.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [skills, index, selected]);
  if (!items.length) return empty ? <div className="agent-menu agent-menu-empty" role="status">{empty}</div> : null;
  return <div ref={menu} className={'agent-menu' + (skills ? ' agent-menu-skills' : '')} role="listbox" aria-label={skills ? '选择技能' : undefined}>
    {items.map((it, i) => <button key={it.key} type="button" role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseDown={e => e.preventDefault()} onClick={() => onPick(it)}>
      {skills && <Sparkles size={14} aria-hidden />}
      <b title={skills ? it.label : undefined}>{it.label}</b>
      {it.detail && <small title={skills ? it.detail : undefined}>{it.detail}</small>}
      {skills && <span className="agent-menu-source">{it.source ?? '执行器'}</span>}
    </button>)}
  </div>;
}

type SkillScope = { taskId: string } | { projectId: string | null; dirId: string | null; profileId: string | null; carryExtensions: boolean };
type Choice = { name: string };
type Lookup = { scopeKey: string; managed: Choice[]; native: Choice[]; failed?: boolean };

export function useComposerSkills(active: boolean, scope: SkillScope) {
  const taskId = 'taskId' in scope ? scope.taskId : null;
  const projectId = 'projectId' in scope ? scope.projectId : null;
  const dirId = 'dirId' in scope ? scope.dirId : null;
  const profileId = 'profileId' in scope ? scope.profileId : null;
  const carryExtensions = 'carryExtensions' in scope && scope.carryExtensions;
  const scopeKey = JSON.stringify([taskId, projectId, dirId, profileId, carryExtensions]);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  useEffect(() => {
    setLookup(null);
    if (!active) return;
    let current = true;
    const result = taskId
      ? rpc.agentTasks.managedSkills(taskId).then(managed => ({ managed, native: [] }))
      : rpc.agentTasks.homeSkillCatalog(projectId, dirId, profileId, carryExtensions);
    void result.then(
      skills => { if (current) setLookup({ scopeKey, ...skills }); },
      () => { if (current) setLookup({ scopeKey, managed: [], native: [], failed: true }); },
    );
    return () => { current = false; };
  }, [active, scopeKey, taskId, projectId, dirId, profileId, carryExtensions]);
  const current = lookup?.scopeKey === scopeKey ? lookup : null;
  return {
    managed: current?.managed,
    native: current?.native,
    loading: active && !current,
    empty: active ? !current ? '正在读取技能…' : current.failed ? '暂时无法读取技能' : '没有匹配的技能' : undefined,
  };
}
