// Simplified from Yoda (Apache-2.0) src/renderer/lib/ui/section-page.tsx + section-nav.tsx:
// nav rail on the left, one section's content on the right under a common header.
import type { ReactNode } from 'react';
import { Separator } from '@renderer/lib/ui/separator';
import { cn } from '@renderer/utils/utils';

export type SectionNavItem<Id extends string> = { id: Id; label: string };

export function SectionPage<Id extends string>({
  items,
  activeId,
  onSelect,
  title,
  description,
  children,
}: {
  items: SectionNavItem<Id>[];
  activeId: Id;
  onSelect: (id: Id) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8">
        <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-6 overflow-hidden">
          <nav className="flex min-h-0 w-max min-w-28 flex-col gap-0.5 overflow-y-auto py-10 pr-2">
            {items.map(({ id, label }) => {
              const isActive = id === activeId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  aria-current={isActive}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                    isActive && 'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                  )}
                >
                  <span className="truncate text-left">{label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
            <div className="mx-auto flex w-full max-w-4xl flex-col py-10 pr-4 pl-1">
              <div className="flex flex-col gap-6">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="text-xl">{title}</h2>
                  {description && <p className="text-sm text-foreground-muted">{description}</p>}
                </div>
                <Separator />
              </div>
              <div className="mt-8 space-y-8">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
    <div className="flex items-center justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="text-xs text-foreground-muted">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
