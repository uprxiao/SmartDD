// Shared layout arithmetic for the production shell and synthetic prototype.
// The outer panel preference is global; tree widths remain scoped workspaces.
export const DEFAULT_FILE_PANEL_RATIO = 0.57;
const DEFAULT_DIRECTORY_PANEL_WIDTH = 250;
export function readFilePanelWidthPreference(raw, directoryOnly = false) {
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return { unit: value <= 1 ? 'ratio' : 'pixels', value };
  return directoryOnly ? { unit: 'pixels', value: DEFAULT_DIRECTORY_PANEL_WIDTH } : { unit: 'ratio', value: DEFAULT_FILE_PANEL_RATIO };
}
export function filePanelBounds(available, directoryOnly = false) {
  const size = Number.isFinite(available) && available > 0 ? available : 0;
  const minimum = Math.min(directoryOnly ? 220 : 420, size * 0.7);
  return { minimum, maximum: Math.max(minimum, size - 240) };
}
export function resolveFilePanelWidth(preference, available, directoryOnly = false) {
  if (!Number.isFinite(available) || available <= 0) return 0;
  const { minimum, maximum } = filePanelBounds(available, directoryOnly);
  const desired = preference.unit === 'ratio' ? preference.value * available : preference.value;
  const fallback = directoryOnly ? DEFAULT_DIRECTORY_PANEL_WIDTH : available * DEFAULT_FILE_PANEL_RATIO;
  return Math.min(maximum, Math.max(minimum, Number.isFinite(desired) ? desired : fallback));
}
export function normalizedFilePanelWidth(width, available, directoryOnly = false) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(available) || available <= 0) return null;
  return { unit: 'ratio', value: resolveFilePanelWidth({ unit: 'pixels', value: width }, available, directoryOnly) / available };
}
