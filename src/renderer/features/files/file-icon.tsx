import type { CSSProperties } from 'react';
import iconMap from './icon-map.json';
import spriteUrl from './assets/tree-icons/icons.svg?no-inline';

// Licensed @pierre/trees symbols, copied unchanged from the approved prototype.
// Toolbar/tab fallback icons remain separately tracked in the M9 visual ledger.
export function FileTreeIcon({ path }: { path: string }) {
  const name = path.split('/').at(-1)?.toLowerCase() ?? '', ext = name.split('.').slice(1);
  const names = iconMap.fileNameTokens as Record<string, string>, complete = iconMap.completeExtensionOverrides as Record<string, string>, extensions = iconMap.extensionTokens as Record<string, string>;
  let type = names[name];
  for (let i = 0; !type && i < ext.length; i++) type = complete[ext.slice(i).join('.')] ?? extensions[ext.slice(i).join('.')];
  type ||= iconMap.defaultType;
  const role = (iconMap.colorRoles as Record<string, string>)[type], colors = (iconMap.palette as Record<string, { light: string; dark: string }>)[role];
  return <svg className="fw-file-icon" width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" style={{ '--file-light': colors?.light ?? 'currentColor', '--file-dark': colors?.dark ?? 'currentColor' } as CSSProperties}><use href={`${spriteUrl}#${iconMap.idPrefix}${type}`} /></svg>;
}
