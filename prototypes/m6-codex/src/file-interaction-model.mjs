// Synthetic, local-only adapters. No filesystem, application launch or native search.
import { rankFileCandidates } from './file-fuzzy-model.mjs';
import { fuzzyScore, SEARCH_EXCLUDES } from './file-workspace-model.mjs';

export const TREE_ROW_HEIGHT = 28;
export function largeDirectoryFixture(groups = 24, perGroup = 250) {
  return Array.from({ length: groups * perGroup }, (_, i) => {
    const group = String(Math.floor(i / perGroup) + 1).padStart(2, '0');
    const number = String(i % perGroup + 1).padStart(4, '0');
    return { path: `大目录/模块-${group}/文件-${number}.ts`, kind: 'code', text: `// 合成大目录样本 ${group}/${number}\nexport const 中文😀 = "needle-${group}-${number}";\n` };
  });
}
export function directoryIndex(files, emptyDirs = []) {
  const index = new Map([['', new Map()]]);
  for (const [path, isDir] of [...files.map(f => [f.path, false]), ...emptyDirs.map(p => [p, true])]) {
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const parent = parts.slice(0, i).join('/'), child = parts.slice(0, i + 1).join('/');
      const folder = i < parts.length - 1 || isDir;
      if (!index.has(parent)) index.set(parent, new Map());
      index.get(parent).set(child, { path: child, name, folder });
      if (folder && !index.has(child)) index.set(child, new Map());
    });
  }
  return new Map([...index].map(([path, entries]) => [path, [...entries.values()].sort((a,b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))]));
}
export function loadedTreeRows(cache, expanded) {
  const rows = [], open = new Set(expanded);
  const visit = (path, depth) => {
    const result = cache[path];
    if (result?.state !== 'ready') return;
    for (const entry of result.entries) {
      rows.push({ ...entry, depth });
      if (!entry.folder || !open.has(entry.path)) continue;
      const child = cache[entry.path];
      if (child?.state === 'ready') {
        if (child.entries.length) visit(entry.path, depth + 1);
        else rows.push({ path: entry.path + '/:empty', parent: entry.path, depth: depth + 1, status: 'empty', name: '此目录为空' });
      } else rows.push({ path: entry.path + '/:status', parent: entry.path, depth: depth + 1, status: child?.state === 'error' ? 'error' : 'loading', name: child?.state === 'error' ? '无法读取目录' : '正在读取目录…' });
    }
  };
  visit('', 0);
  return rows;
}
export function virtualTreeWindow(rows, scrollTop, height, overscan = 4) {
  const top = Math.max(0, scrollTop), start = Math.max(0, Math.floor(top / TREE_ROW_HEIGHT) - overscan);
  const end = Math.min(rows.length, Math.ceil((top + Math.max(TREE_ROW_HEIGHT, height)) / TREE_ROW_HEIGHT) + overscan);
  return { start, end, total: rows.length * TREE_ROW_HEIGHT, rows: rows.slice(start, end) };
}
export function stickyTreeAncestors(rows, scrollTop, max = 3) {
  const first = rows[Math.min(rows.length - 1, Math.floor(Math.max(0, scrollTop) / TREE_ROW_HEIGHT))];
  if (!first) return [];
  return rows.filter((row, i) => row.folder && first.path.startsWith(row.path + '/') && i * TREE_ROW_HEIGHT < scrollTop).slice(-max);
}
export function nearestTreeScroll(index, scrollTop, height, stickyHeight = 0) {
  const top = Math.max(0, index) * TREE_ROW_HEIGHT, bottom = top + TREE_ROW_HEIGHT;
  if (top < scrollTop + stickyHeight) return Math.max(0, top - stickyHeight);
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}
export function latestRequestGate() {
  let current = null, serial = 0;
  return {
    start(scope) {
      current?.controller.abort();
      const controller = new AbortController(), token = { scope, serial: ++serial, controller, signal: controller.signal };
      current = token;
      return token;
    },
    accepts(token) { return current === token && !token.signal.aborted; },
    cancel() { current?.controller.abort(); current = null; },
  };
}
export function abortError() { const error = new Error('Request cancelled'); error.name = 'AbortError'; return error; }
export function waitForFixture(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export function createFixtureFileProvider(files, { emptyDirs = [], delay = 60, failDirectories = [] } = {}) {
  const index = directoryIndex(files, emptyDirs), failed = new Set(), requests = [];
  return {
    requests,
    async list(path, { signal } = {}) {
      requests.push({ type: 'list', path });
      await waitForFixture(delay, signal);
      if (failDirectories.includes(path) && !failed.has(path)) { failed.add(path); throw new Error('示例目录读取被拒绝；重试恢复。'); }
      if (!index.has(path)) throw new Error('示例目录不存在。');
      return index.get(path);
    },
    async names(query, { signal, mode = 'ready' } = {}) {
      requests.push({ type: 'names', query });
      await waitForFixture(mode === 'slow' ? 750 : delay, signal);
      if (mode === 'error') throw new Error('示例候选服务失败；输入已保留。');
      const needle = query.trim().replaceAll('*', ''), candidates = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.path.split('/').some(p => SEARCH_EXCLUDES.has(p)) && fuzzyScore(file.path, needle) >= 0) candidates.push(file);
        if (i % 200 === 199) await waitForFixture(0, signal);
      }
      if (signal?.aborted) throw abortError();
      return rankFileCandidates(query, candidates);
    },
    async content(query, mask, { signal, onChunk = () => {}, mode = 'ready' } = {}) {
      requests.push({ type: 'content', query, mask });
      await waitForFixture(mode === 'slow' ? 750 : delay, signal);
      if (mode === 'error') throw new Error('示例全文搜索失败；请重试。');
      const trimmed = mask.trim(), negate = trimmed.startsWith('!'), raw = negate ? trimmed.slice(1) : trimmed;
      const escaped = raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '.').replace(/\u0000/g, '.*');
      const pattern = raw ? new RegExp('(?:^|/)' + escaped + '$', 'i') : null;
      const hits = [], needle = query.toLowerCase(); let batch = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!pattern || (negate ? !pattern.test(file.path) : pattern.test(file.path))) {
          const lines = (file.text || '').split('\n');
          for (let j = 0; j < lines.length; j++) {
            const column = lines[j].toLowerCase().indexOf(needle) + 1;
            if (column > 0) {
              if (hits.length === 100) { if (batch.length) onChunk(batch); return { hits, capped: true }; }
              const hit = { path: file.path, line: lines[j], number: j + 1, column };
              hits.push(hit); batch.push(hit);
            }
          }
        }
        if (i % 100 === 99) { if (batch.length) { onChunk(batch); batch = []; } await waitForFixture(0, signal); }
      }
      if (signal?.aborted) throw abortError();
      if (batch.length) onChunk(batch);
      return { hits, capped: false };
    },
  };
}
