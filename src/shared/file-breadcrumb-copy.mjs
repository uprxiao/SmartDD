// Preserve filename text; only actual breadcrumb separator elements become slashes.
export function breadcrumbSelectionText(container, selection, absolutePath) {
  if (!selection?.rangeCount || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return null;
  const selected = selection.toString();
  if (!selected) return null;
  // Selection.toString() includes browser layout breaks between inline controls.
  // Compare the selected DOM text without removing real filename whitespace.
  if (absolutePath && selection.rangeCount === 1 && selection.getRangeAt(0).cloneContents().textContent === container.textContent) return absolutePath;
  const pieces = [];
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index), fragment = range.cloneContents();
    const ancestor = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (ancestor?.closest('.fw-crumb-chevron, [data-breadcrumb-separator]')) {
      pieces.push(fragment.textContent?.replaceAll('›', '/') ?? '');
      continue;
    }
    for (const separator of fragment.querySelectorAll('.fw-crumb-chevron, [data-breadcrumb-separator]')) {
      const text = separator.namespaceURI === 'http://www.w3.org/2000/svg' || separator.textContent ? '/' : '';
      separator.replaceWith(container.ownerDocument.createTextNode(text));
    }
    pieces.push(fragment.textContent ?? '');
  }
  return pieces.join('');
}
