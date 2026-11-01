/** Serializable host-owned metadata. It contains no functions, credentials or executable source. */
export interface ApplicationFormField {
  key: string; title: string; label: string; type: 'text' | 'url' | 'email' | 'number' | 'select' | 'directory';
  required?: boolean; immutable?: boolean; placeholder?: string; note?: string; autoComplete?: string;
  min?: number; max?: number; step?: number; options?: readonly { value: string; label: string }[];
  format?: 'http-base-url' | 'host'; trim?: boolean;
  validation: string;
}
export interface ApplicationProviderPresentation {
  id: string; appId: string; title: string; initial: Readonly<Record<string, string | number>>;
  groups: readonly (ApplicationFormField | { row: readonly ApplicationFormField[] })[];
  intro?: string; icon: 'link' | 'folder' | 'send';
  summaryFields: readonly string[]; locationField: string;
  secret: null | { title: string; conditionalTitle?: { field: string; value: string; title: string }; authModeValidation: string };
  project: { title: string; unselectedTitle?: string; unselectedNote: string };
  supplemental?: { title: string; note: string; action: string };
  diagnosticTitle?: string;
  /** Generated from the host provider schema. Client validation is never authorization. */
  configSchema?: Record<string, unknown>;
}
export interface ApplicationPresentation {
  displayName: string; projectNote: string; emptyConnectionSuffix: string;
  defaultProvider: string; panel: string | null; switchTitle: string;
  heading?: string; mark?: 'envelope' | 'zigzag' | 'link';
}
