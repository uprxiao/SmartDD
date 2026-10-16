// Keep the preview icons aligned with src/renderer/lib/ui/rail-icon.tsx.
import { Bot, Clock3, Ellipsis, GitBranch, House, LayoutGrid } from 'lucide-react';

const outlines = { home: House, clock: Clock3, bot: Bot, branch: GitBranch, grid: LayoutGrid, more: Ellipsis };

/** Selected icons have a solid silhouette and retain their inner cutouts. */
export function RailIcon({ name, selected = false }) {
  const Outline = outlines[name];
  if (!selected) return <Outline aria-hidden="true" size={22} strokeWidth={1.7} />;
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="none">
    {name === 'home' && <path d="M10.5 2.7a2.4 2.4 0 0 1 3 0l8 6.6c1.2 1 .5 2.7-1 2.7H20v7.2a2.3 2.3 0 0 1-2.3 2.3H15v-6a3 3 0 0 0-6 0v6H6.3A2.3 2.3 0 0 1 4 19.2V12h-.5c-1.5 0-2.2-1.7-1-2.7z" />}
    {name === 'clock' && <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l-3.5 2" fill="none" stroke="var(--rail-selected)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>}
    {name === 'bot' && <><path d="M11 2h2v4h5a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3h5zM0 11h2v6H0zm22 0h2v6h-2z" /><path d="M8 11v4m8-4v4" stroke="var(--rail-selected)" strokeWidth="2" strokeLinecap="round" /></>}
    {name === 'grid' && <>{[[3, 3], [14, 3], [3, 14], [14, 14]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="7" height="7" rx="1.7" />)}</>}
    {name === 'branch' && <><path d="M6 6v12m12-12a6 6 0 0 1-6 6 6 6 0 0 0-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="6" cy="5" r="3" /><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /></>}
    {name === 'more' && <>{[5, 12, 19].map(cx => <circle key={cx} cx={cx} cy="12" r="1.9" />)}</>}
  </svg>;
}
