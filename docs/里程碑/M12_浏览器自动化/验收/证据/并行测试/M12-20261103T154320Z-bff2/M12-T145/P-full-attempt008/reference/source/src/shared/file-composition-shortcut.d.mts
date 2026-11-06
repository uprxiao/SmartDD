interface CompositionKey {
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  getModifierState?(key: string): boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
export function guardEditorComposition(event: CompositionKey, ownsCommands?: boolean): boolean;
