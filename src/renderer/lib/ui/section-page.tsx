// Originally adapted from Yoda (Apache-2.0); M6 uses the approved prototype's
// horizontal project tabs while preserving the existing section contract.
import { FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';

export type SectionNavItem<Id extends string> = { id: Id; label: string };

export function SectionPage<Id extends string>({
  items,
  activeId,
  onSelect,
  title,
  description,
  children,
  actions,
}: {
  items: SectionNavItem<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return <section className="project-page"><div className="project-page-inner parity-project">
    <div className="page-heading"><div><div className="title-with-icon"><FolderOpen size={25} /><h1>{title}</h1></div>{description && <p>{description}</p>}</div>{actions}</div>
    <nav className="tabbar" aria-label={title}>{items.map(({ id, label }) => <button key={id} type="button" onClick={() => onSelect(id)} aria-current={id === activeId ? 'page' : undefined} className={id === activeId ? 'active' : ''}>{label}</button>)}</nav>
    <div className="m6-project-content">{children}</div>
  </div></section>;
}

/** One labelled row: title + hint on the left, control on the right. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="m6-setting-label">{label}</span>
        {hint && <span className="m6-setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
