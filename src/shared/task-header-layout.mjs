// Match the content width, so adjacent panels can resize without changing menu layers.
export function observeTaskHeaderLayout(element, onLayout) {
  if (!element) return () => {};
  const view = element.ownerDocument.defaultView;
  if (!view) return () => {};
  const update = width => {
    if (Number.isFinite(width) && width > 0) {
      onLayout(width <= 235 ? 'minimal' : width <= 420 ? 'compact' : 'default');
    }
  };
  const measure = () => {
    const style = view.getComputedStyle(element);
    const pixels = value => Number.parseFloat(value) || 0;
    update(element.getBoundingClientRect().width
      - pixels(style.paddingLeft) - pixels(style.paddingRight)
      - pixels(style.borderLeftWidth) - pixels(style.borderRightWidth));
  };
  measure();
  if (view.ResizeObserver) {
    const observer = new view.ResizeObserver(entries => {
      const entry = entries.find(item => item.target === element);
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }
  view.addEventListener('resize', measure);
  return () => view.removeEventListener('resize', measure);
}
