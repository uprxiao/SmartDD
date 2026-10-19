export function bindPdfWheel(node: HTMLElement, options: {
  getZoom(): number;
  setZoom(value: number): void;
  onZooming(value: boolean): void;
  onAnchor?(position: { left: number; top: number }): void;
}): () => void;
