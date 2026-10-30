// Public synthetic Notebook data shared by production/prototype acceptance.
export function notebookHeaderFixtures() {
  const cells = [
    { cell_type: 'code', metadata: { title: '代码标题 中文🙂' }, execution_count: 0, source: 'print("HEADER_ZERO")', outputs: [] },
    { cell_type: 'code', metadata: { codex: { descriptionMarkdown: '说明标题' } }, execution_count: 7, source: 'print("HEADER_SEVEN")', outputs: [] },
    { cell_type: 'markdown', metadata: {}, source: '# Markdown 标题\n\nHEADER_MARKDOWN' },
    { cell_type: 'raw', metadata: {}, source: 'HEADER_RAW_中文🙂' },
  ];
  return Object.fromEntries([
    ['metadata-title.ipynb', { title: '顶部标题 中文🙂', language_info: { name: 'python' } }],
    ['filename-fallback.ipynb', { language_info: { name: 'python' } }],
  ].map(([name, metadata]) => [name, JSON.stringify({ cells, metadata, nbformat: 4, nbformat_minor: 5 }, null, 2).replace(/\n/g, '\r\n') + '\r\n']));
}
