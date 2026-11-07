export type TaskHeaderLayout = 'default' | 'compact' | 'minimal';
export function observeTaskHeaderLayout(
  element: HTMLElement | null,
  onLayout: (layout: TaskHeaderLayout) => void,
): () => void;
