export interface FilePanelWidthPreference { unit: 'ratio' | 'pixels'; value: number }
export const DEFAULT_FILE_PANEL_RATIO: number;
export function readFilePanelWidthPreference(raw: string | null | undefined, directoryOnly?: boolean): FilePanelWidthPreference;
export function filePanelBounds(available: number, directoryOnly?: boolean): { minimum: number; maximum: number };
export function resolveFilePanelWidth(preference: FilePanelWidthPreference, available: number, directoryOnly?: boolean): number;
export function normalizedFilePanelWidth(width: number, available: number, directoryOnly?: boolean): FilePanelWidthPreference | null;
