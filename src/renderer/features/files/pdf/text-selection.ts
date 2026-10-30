/* Selection lifecycle adapted from PDF.js 5.4.296 TextLayerBuilder
 * (Apache-2.0; see licenses/M9). Keep the existing native copy behaviour. */
interface SelectionRegistry {
  layers: Map<HTMLDivElement, HTMLDivElement>;
  controller: AbortController;
}
const registries = new WeakMap<Document, SelectionRegistry>();

function createRegistry(document: Document): SelectionRegistry {
  const view = document.defaultView!;
  const layers = new Map<HTMLDivElement, HTMLDivElement>();
  const controller = new view.AbortController(), { signal } = controller;
  const reset = (end: HTMLDivElement, layer: HTMLDivElement) => {
    layer.append(end);
    end.style.width = '';
    end.style.height = '';
    layer.classList.remove('selecting');
  };
  let pointerDown = false, previousRange: Range | null = null;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, { signal });
  document.addEventListener('pointerup', () => { pointerDown = false; layers.forEach(reset); }, { signal });
  view.addEventListener('blur', () => { pointerDown = false; layers.forEach(reset); }, { signal });
  document.addEventListener('keyup', () => { if (!pointerDown) layers.forEach(reset); }, { signal });
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    if (!selection?.rangeCount) { layers.forEach(reset); previousRange = null; return; }
    const active = new Set<HTMLDivElement>();
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      for (const layer of layers.keys()) if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
    }
    for (const [layer, end] of layers) {
      if (active.has(layer)) layer.classList.add('selecting');
      else reset(end, layer);
    }
    // A selection elsewhere must neither move a PDF sentinel nor retain its DOM.
    if (!active.size) { previousRange = null; return; }
    const firstEnd = layers.values().next().value!;
    if (view.getComputedStyle(firstEnd).getPropertyValue('-moz-user-select') === 'none') return;
    const range = selection.getRangeAt(0);
    const modifyStart = previousRange !== null &&
      (range.compareBoundaryPoints(view.Range.END_TO_END, previousRange) === 0 ||
       range.compareBoundaryPoints(view.Range.START_TO_END, previousRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === view.Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
        anchor = anchor?.previousSibling ?? null;
      } while (anchor && !anchor.childNodes.length);
    }
    const layer = anchor?.parentElement?.closest<HTMLDivElement>('.textLayer');
    const end = layer && layers.get(layer);
    if (end && layer && anchor?.parentElement) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
    }
    previousRange = range.cloneRange();
  }, { signal });
  return { layers, controller };
}

/** Call after TextLayer.render; release before cancelling/replacing that layer. */
export function attachPdfTextSelection(layer: HTMLDivElement): () => void {
  const document = layer.ownerDocument;
  let registry = registries.get(document);
  if (!registry) { registry = createRegistry(document); registries.set(document, registry); }
  const end = document.createElement('div'), priorTabIndex = layer.getAttribute('tabindex');
  end.className = 'endOfContent';
  layer.append(end);
  if (priorTabIndex === null) layer.tabIndex = 0;
  const selecting = () => { layer.classList.add('selecting'); };
  layer.addEventListener('mousedown', selecting);
  registry.layers.set(layer, end);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    layer.removeEventListener('mousedown', selecting);
    layer.classList.remove('selecting');
    if (priorTabIndex === null) layer.removeAttribute('tabindex');
    else layer.setAttribute('tabindex', priorTabIndex);
    end.remove();
    registry.layers.delete(layer);
    if (!registry.layers.size) {
      registry.controller.abort();
      registries.delete(document);
    }
  };
}
