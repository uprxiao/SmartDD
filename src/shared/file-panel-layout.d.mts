export interface FilePanelWidthPreference { unit: 'ratio' | 'pixels'; value: number }
export const DEFAULT_FILE_PANEL_RATIO: number;
export function readFilePanelWidthPreference(raw: string | null | undefined): FilePanelWidthPreference;
export function filePanelBounds(available: number): { minimum: number; maximum: number };
export function resolveFilePanelWidth(preference: FilePanelWidthPreference, available: number): number;
export function normalizedFilePanelWidth(width: number, available: number): FilePanelWidthPreference | null;
