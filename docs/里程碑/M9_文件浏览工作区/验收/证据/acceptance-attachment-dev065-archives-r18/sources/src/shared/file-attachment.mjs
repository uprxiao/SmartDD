// Presentation hints never replace byte classification or file authority.
// These are WillYou's explicit aliases, not unverified private-runtime parity.
export function attachmentTextKind(name, mimeType) {
  const leaf = name.split('/').at(-1).toLowerCase();
  const extension = leaf.includes('.') ? leaf.split('.').at(-1) : '';
  if (['html', 'htm'].includes(extension)) return 'html';
  if (['md', 'markdown', 'mdown', 'mkd'].includes(extension)) return 'markdown';
  if (extension === 'txt') return 'text';
  if (extension) return null;
  const mime = typeof mimeType === 'string' ? mimeType.split(';', 1)[0].trim().toLowerCase() : '';
  if (mime === 'text/html') return 'html';
  if (['text/markdown', 'text/x-markdown'].includes(mime)) return 'markdown';
  if (mime === 'text/plain') return 'text';
  return null;
}
export function fileTextPresentation(name, attachment) {
  if (attachment?.textKind) return attachment.textKind === 'text' ? 'source' : attachment.textKind;
  if (/\.(?:csv|tsv)$/i.test(name)) return 'csv';
  if (/\.tex$/i.test(name)) return 'tex';
  if (attachment) return 'source';
  if (/\.(?:md|markdown|mdown|mdx|mkd)$/i.test(name)) return 'markdown';
  if (/\.html?$/i.test(name)) return 'html';
  return 'source';
}
