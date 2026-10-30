// Shared layout arithmetic for the production shell and synthetic prototype.
// The outer panel preference is global; tree widths remain scoped workspaces.
export const DEFAULT_FILE_PANEL_RATIO = 0.57;
export function readFilePanelWidthPreference(raw) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? { unit: value <= 1 ? 'ratio' : 'pixels', value }
    : { unit: 'ratio', value: DEFAULT_FILE_PANEL_RATIO };
}
export function filePanelBounds(available) {
  const size = Number.isFinite(available) && available > 0 ? available : 0;
  const minimum = Math.min(420, size * 0.7);
  return { minimum, maximum: Math.max(minimum, size - 240) };
}
export function resolveFilePanelWidth(preference, available) {
  if (!Number.isFinite(available) || available <= 0) return 0;
  const { minimum, maximum } = filePanelBounds(available);
  const desired = preference.unit === 'ratio' ? preference.value * available : preference.value;
  return Math.min(maximum, Math.max(minimum, Number.isFinite(desired) ? desired : available * DEFAULT_FILE_PANEL_RATIO));
}
export function normalizedFilePanelWidth(width, available) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(available) || available <= 0) return null;
  return { unit: 'ratio', value: resolveFilePanelWidth({ unit: 'pixels', value: width }, available) / available };
}
