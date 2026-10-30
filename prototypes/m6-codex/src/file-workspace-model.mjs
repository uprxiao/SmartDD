import {durablePrototypeReadings} from './file-reading-model.mjs';
import {pptxGroupExample} from './file-pptx-group-example.mjs';
// Original interaction model. Synthetic data only; no native filesystem access.
import { rankFileCandidates } from './file-fuzzy-model.mjs';
export const REFERENCE_REV = 'M9-R2-20261017';
export const SAMPLE_MD = `# SmartDD 协作与发布约定

本文件是 Codex 与 Claude Code 共用的项目规则。用户在当前会话明确提出的要求优先。

## 开发与分支

- 在 feature/<版本号> 分支开发，同一版本完成前沿用该分支。
- main 保存经过验证、可发布的代码。
- 开始工作先检查当前分支与工作区，保留用户和其他 Agent 的改动。
- 有适用的现成实现就复用，按项目实际依赖和配置适配。

## Codex UI 细粒度复刻

- 逐项对齐布局、尺寸、字体、颜色、图标、间距与微交互。
- 覆盖浅色、深色、选中、悬停和长文本状态。
- 中央运行工作区继续使用终端。

## 验收与交付

需求、原型、技术方案与测试用例必须逐项对应。未经验证的状态不能宣称完全一致。
`;
export const FILES = [['AGENTS.md', 'markdown', SAMPLE_MD], ['CLAUDE.md', 'markdown', '# CLAUDE.md\n\n请先阅读 AGENTS.md 中的项目约定。'], ['CHANGELOG.md', 'markdown', '# 变更记录\n\n## M9\n\n文件浏览工作区 · 设计预览'], ['.gitignore', 'code', 'node_modules/\nrelease/\n.DS_Store'], ['.DS_Store', 'unsupported', ''], ['package.json', 'code', '{\n  "name": "smartdd",\n  "displayName": "WillYou",\n  "version": "0.0.5"\n}\n'], ['src/main.ts', 'code', 'import { app } from "electron";\n\n// 示例，不执行\nexport const workspace = {\n  name: "WillYou",\n  root: "SmartDD"\n};\n'], ['src/renderer/App.tsx', 'code', 'export function App() {\n  return <main>WillYou</main>;\n}\n'], ['docs/需求.md', 'markdown', '# 文件浏览工作区\n\n## 目标\n\n完整记录每个文件行为，保留独立终端会话。\n\n- 懒加载目录\n- 预览与固定标签\n- 编辑、保存与冲突恢复'], ['docs/图文说明.md', 'markdown', '# 图文说明\n\n普通文件图片与 Markdown 嵌入图片使用不同入口。\n\n![WillYou 图标](/assets/app-icon.png)\n\n## 第二张图片\n\n![WillYou 图标副本](/assets/app-icon.png)'], ['docs/一份需要完整展示而不能挤掉关闭按钮的很长的中文需求文档名称.md', 'markdown', '# 长文件名\n\n悬停查看完整路径，标签保留关闭入口。'], ['docs/验收.pdf', 'pdf', '验收记录'], ['docs/概要设计.docx', 'docx', '项目文档与文件工作区'], ['docs/发布演示.pptx', 'pptx', '文件工作区'], ['docs/数据.xlsx', 'xlsx', ''], ['docs/含宏工作簿.xlsm', 'xlsx', ''], ['docs/数据.csv', 'code', '阶段,名称,状态\nM8,项目导入导出,已完成\nM9,文件浏览工作区,设计中'], ['docs/数据.tsv', 'code', '阶段\t名称\t状态\nM9\t文件浏览工作区\t设计中'], ['docs/实验.ipynb', 'ipynb', '{ "cells": [{"cell_type":"markdown", "source":["# M9 实验"]}], "nbformat":4 }'], ['docs/公式.tex', 'code', '\\documentclass{article}\n\\begin{document}\nE = mc^2\n\\end{document}'], ['resources/app-icon.png', 'image', '/assets/app-icon.png'], ['resources/vector.svg', 'svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><text x="10" y="45">WillYou</text></svg>'], ['resources/录音.wav', 'audio', ''], ['resources/演示.webm', 'video', ''], ['resources/扫描.tiff', 'unsupported', ''], ['index.html', 'html', '<!doctype html>\n<html lang="zh"><body><h1>WillYou</h1><p>文件文档预览</p></body></html>'], ['fixtures/large.log', 'large', '只读大文件示例\n'.repeat(30)], ['fixtures/too-large.log', 'too-large', ''], ['fixtures/不可读.txt', 'unreadable', ''], ['fixtures/已删除.md', 'missing', ''], ['fixtures/未知.bin', 'unsupported', ''], ['fixtures/empty.txt', 'code', ''], ['licenses/NOTICE', 'code', '示例文件。图标上游及许可证见 assets/m9-file-icons。'], ['drizzle/schema.ts', 'code', 'export const schema = {};'], ['native/README.md', 'markdown', '# Native\n\n本机模块'], ['scripts/build.mjs', 'code', '// 构建示例']].map(([path, kind, text]) => ({
  path,
  kind,
  text
}));
FILES.push({path:'docs/组合对象示例（合成）.pptx',kind:'pptx',text:pptxGroupExample});
FILES.push({path:'docs/绘图能力提示（合成）.xlsx',kind:'xlsx',text:JSON.stringify({sheets:[{id:'drawing-warning',name:'Drawing',cells:[['Drawing notice fixture','42']],objects:[{id:'retained-drawing',kind:'unsupported-drawing',title:'原件内保留的绘图对象'}]}]})});
export const LONG_ENGLISH_PATH = 'docs/LongEnglishFilenameWithoutWhitespaceLongEnglishFilenameWithoutWhitespaceLongEnglishFilenameWithoutWhitespaceLongEnglishFilen.txt';
FILES.push({path:LONG_ENGLISH_PATH,kind:'code',text:'Synthetic long English filename.\nThis known text belongs only to this prototype file.\n'});
FILES.push({path:'docs/Markdown完整交互.md',kind:'markdown',text:`---
title: 文件工作区
status: 设计中
---
# Markdown 完整交互

点击文字可直接编辑；离开后恢复格式。**加粗**、*斜体*、~~删除线~~ 和 \`code\`。

> 保留文件与会话的独立状态。

- [ ] 验证直接编辑
- [x] 已记录需求

| 阶段 | 内容 |
| --- | --- |
| M9 | 文件工作区 |

[打开需求](需求.md)

![图标](/assets/app-icon.png)

![图示](/assets/m9-image-fixture.svg)

\`\`\`typescript
const name = "WillYou";
\`\`\`

$$
E = mc^2
$$

\`\`\`mermaid
flowchart LR
  A[需求] --> B[原型] --> C[验收]
\`\`\`
`});
FILES.push({path:'docs/Markdown语法全集.md',kind:'markdown',text:`---
title: 语法全集
tags: [markdown, 样例]
meta: {owner: WillYou, rev: 3}
---
# 一级标题 😀 中文 emoji

Setext 二级标题
---------------

段落含 **加粗**、*斜体*、~~删除线~~、\`行内代码\`、<b>不会执行的 HTML</b> 与自动转义 &amp; 实体，行末两空格换行  
下一行。行内公式 $a^2+b^2=c^2$，价格 $5 和 $6 不是公式。

1. 有序一
   - 嵌套无序 **加粗**
     1. 三层有序
   - [ ] 嵌套任务
2. 有序二
   - [x] 已完成任务

> 引用第一层
> > 引用第二层
> - 引用中的列表

| 左对齐 | 居中 | 右对齐 |
|:-------|:----:|-------:|
| \`a\\|b\` | **粗** | 12.50 |
| 中文 | 😀 | 3 |

使用 [引用式链接][doc]、[相对文件](../AGENTS.md) 和 [外部地址](https://example.invalid)。

[doc]: 需求.md "引用定义保留为源码"

\`\`\`typescript
const html = "<script>alert(1)</script>";
\`\`\`

    缩进代码块

$$
\\begin{aligned} \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix} &= M \\\\ \\int_0^1 x^2\\,dx &= \\frac{1}{3} \\end{aligned}
$$

\`\`\`mermaid
sequenceDiagram
  用户->>终端: 提交修改请求
  终端-->>用户: 返回结果
\`\`\`

\`\`\`mermaid
classDiagram
  class FileWorkspace
  FileWorkspace --> Tab
\`\`\`

***

![图示](/assets/m9-image-fixture.svg)
`});
FILES.push({path:'docs/Markdown异常样例.md',kind:'markdown',text:`---
title: [未闭合
---
# 异常样例

无效公式：$\\frac{1$ 之后仍可编辑。

\`\`\`mermaid
flowchart LR
  A --> 
\`\`\`

未闭合围栏会延伸到文件末尾：

\`\`\`js
still code
`});
// 引用安全演示：第 2 行含 ESC[201~（提前结束括号粘贴）与 ^C（中断前台进程）。放入终端前必须被清理。
FILES.push({path:'docs/拖放 空格示例.txt',kind:'code',text:'用于核对完整路径拖放，文件内容不进入终端。'});
FILES.push({path:'docs/路径 中文 space 🙂.txt',kind:'code',text:'E04 合成文件名：中文、空格与 emoji；用于复制路径验收，不访问真实文件。'});
FILES.push({path:'fixtures/控制字符.txt',kind:'code',text:'safe line\nx\u001b[201~\u0003touch INJECTED\ntail\n'});
export const FILE_BY_PATH = Object.fromEntries(FILES.map(f => [f.path, f]));
export const EMPTY_DIRS = ['node_modules', 'out', 'prototypes', 'release', 'fixtures/空目录'];
export const SEARCH_EXCLUDES = new Set(['.git', '.hg', '.next', '.pnpm-store', '.svn', '.turbo', '.yarn', 'build', 'coverage', 'dist', 'node_modules']);
export function fuzzyScore(path, query) {
  let score = 0,
    pos = -1;
  for (const c of query.toLowerCase()) {
    const next = path.toLowerCase().indexOf(c, pos + 1);
    if (next < 0) return -1;
    score += next === pos + 1 ? 10 : 1;
    pos = next;
  }
  return score + (path.split('/').pop().toLowerCase().startsWith(query.toLowerCase()) ? 100 : 0);
}
export function searchFiles(files, query) {
  // Mock candidate provider: a path subsequence, not the native search service.
  // Ranking is separate and retains basename zero-score path matches.
  const candidates = files.filter(f => !f.path.split('/').some(p => SEARCH_EXCLUDES.has(p)))
    .filter(f => fuzzyScore(f.path.replaceAll('\\', '/'), query.trim().replaceAll('*', '').replaceAll('\\', '/')) >= 0);
  return rankFileCandidates(query, candidates);
}
export function directoryChildren(files, prefix = '') {
  const base = prefix ? prefix.replace(/\/+$/, '') + '/' : '';
  const entries = new Map();
  for (const f of files) {
    if (!f.path.startsWith(base)) continue;
    const tail = f.path.slice(base.length);
    if (!tail) continue;
    const name = tail.split('/')[0], path = base + name;
    entries.set(path, { path, name, folder: tail.includes('/') });
  }
  return [...entries.values()].sort((a,b) => Number(b.folder)-Number(a.folder) || a.name.localeCompare(b.name));
}
export function searchTreeRows(files, query, collapsed = []) {
  return rankedTreeRows(searchFiles(files, query), collapsed);
}
export function rankedTreeRows(ranked, collapsed = []) {
  const rows = new Map(), childrenByParent = new Map(), hidden = new Set(collapsed);
  for (const file of ranked) {
    const parts=file.path.split('/');
    for(let i=0;i<parts.length;i++) {
      const path=parts.slice(0,i+1).join('/');
      if(rows.has(path))continue;
      rows.set(path,{path,name:parts[i],folder:i<parts.length-1,depth:i,score:file.score,indices:i===parts.length-1?file.indices:[]});
      const parent=parts.slice(0,i).join('/');
      if(!childrenByParent.has(parent))childrenByParent.set(parent,[]);
      childrenByParent.get(parent).push(path);
    }
  }
  // Compact a chain with only one directory child; leaves retain a visible parent.
  const compact=[],visible=new Set();
  for(const row of rows.values()) {
    const parts=row.path.split('/'), ancestors=parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));
    if(ancestors.some(path=>hidden.has(path)))continue;
    const children=childrenByParent.get(row.path)||[];
    if(row.folder&&children.length===1&&rows.get(children[0]).folder&&!hidden.has(row.path))continue;
    const visibleParents=ancestors.filter(path=>visible.has(path)),parent=visibleParents.at(-1);
    compact.push({...row,depth:visibleParents.length,name:row.folder?row.path.slice(parent?parent.length+1:0):row.name});
    if(row.folder)visible.add(row.path);
  }
  return compact;
}
export function treeKeyboardIntent(rows, expanded, focusedPath, key, { shift=false, toggle=false, anchor=focusedPath, selected=[] } = {}) {
  if (!rows.length) return {};
  const index = Math.max(0, rows.findIndex(r => r.path === focusedPath)), row = rows[index];
  if (key === 'ArrowRight' && row.folder && !expanded.includes(row.path)) return { expand:row.path };
  if (key === 'ArrowRight' && (!row.folder || !rows[index+1]?.path.startsWith(row.path+'/'))) return {};
  if (key === 'ArrowLeft' && row.folder && expanded.includes(row.path)) return { collapse:row.path };
  if (toggle && key === ' ') return { selected:selected.includes(row.path) ? selected.filter(p=>p!==row.path) : [...selected,row.path], anchor:row.path };
  if (toggle && key.toLowerCase() === 'a') return { selected:rows.map(r=>r.path), anchor:row.path };
  let next = index;
  if (key === 'ArrowLeft') { const parents=rows.filter(r=>r.folder&&row.path.startsWith(r.path+'/')).sort((a,b)=>b.path.length-a.path.length); next=parents.length?rows.indexOf(parents[0]):index; }
  else if (key === 'Home') next=0;
  else if (key === 'End') next=rows.length-1;
  else if (key === 'ArrowDown' || key === 'ArrowRight') next=Math.min(rows.length-1,index+1);
  else if (key === 'ArrowUp') next=Math.max(0,index-1);
  else return {};
  const result={focus:rows[next].path};
  if (shift) {let start=rows.findIndex(r=>r.path===anchor);if(start<0)start=index; // 没有有效锚点时从当前焦点行开始，而不是第一行
    result.selected=rows.slice(Math.min(start,next),Math.max(start,next)+1).map(r=>r.path);result.anchor=rows[start].path;}
  return result;
}
export function serializeWorkspaceStore(store) {
  return {
    ...store,
    ...Object.fromEntries(Object.entries(store).filter(([k]) => k !== 'saved' && k !== 'fileOpener').map(([key, s]) => {
      const tabs = s.tabs.filter(t => !t.preview && !t.attachment).map(t => ({ root: t.root, path: t.path, preview: false, ...(['source','review'].includes(t.navigationView) ? { navigationView: t.navigationView } : {}), ...(pdfReadingHint(t.pdf) ? { pdf: pdfReadingHint(t.pdf) } : {}) }));
      return [key, {
        ...s,
        tabs,
        ...(s.readings?{readings:durablePrototypeReadings(s,tabs,(s.closed||[]).filter(t=>!t.attachment))}:{}),
        closed: (s.closed || []).filter(t => !t.attachment).map(t => ({ root: t.root, path: t.path, preview: false, index: t.index, ...(['source','review'].includes(t.navigationView) ? { navigationView: t.navigationView } : {}), ...(pdfReadingHint(t.pdf) ? { pdf: pdfReadingHint(t.pdf) } : {}) })),
        active: tabs.some(t => fileKey(t.root, t.path) === s.active) ? s.active : tabs[0] ? fileKey(tabs[0].root, tabs[0].path) : null
      }];
    }))
  };
}
export function fileKey(root, path) {
  return root + '\u0000' + path;
}
export function workspaceScope(taskId, roots) {
  return JSON.stringify([taskId, roots.map(r => [r.id, r.hostId || 'local', r.path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'])]);
}
/** Synthetic close preparation only; preserve routes, other tasks and recovery data. */
export function preparePrototypeTaskClose(store, taskId, action = 'save') {
  let next = store;
  for (const scope of Object.keys(store)) {
    let identity;
    try { identity = JSON.parse(scope); } catch { continue; }
    if (!Array.isArray(identity) || identity[0] !== taskId || !Array.isArray(identity[1])) continue;
    const state = next[scope];
    if (!state?.drafts) continue;
    const roots = identity[1].map(([id, hostId, path]) => ({ id, hostId, path }));
    if (action === 'discard') { next = { ...next, [scope]: { ...state, drafts: {} } }; continue; }
    for (const key of Object.keys(state.drafts)) {
      const outcome = commitDraft(next, scope, roots, key);
      next = outcome.store;
      if (!['saved', 'clean'].includes(outcome.result)) return { store: next, ready: false, message: '示例文件尚未保存，原会话与恢复材料仍保留。', canDiscard: true };
    }
  }
  return { store: next, ready: true };
}
// Tab route keys are task-local aliases. Saved identity is host + absolute path;
// overlapping roots are navigation contexts, not distinct copies of a document.
// This normalizes synthetic paths only; production canonicalization belongs to main.
export function documentKey(roots, routeKey) {
  if (!routeKey) return null;
  const separator = routeKey.indexOf('\u0000');
  const root = roots.find(r => r.id === routeKey.slice(0, separator));
  if (!root || separator < 0) return null;
  const rootPath = root.path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  const segments=[];
  for(const part of (rootPath+'/'+routeKey.slice(separator+1)).split('/')){
    if(part==='..')segments.pop();else if(part&&part!=='.')segments.push(part);
  }
  return JSON.stringify([root.hostId || 'local', (rootPath.startsWith('/')?'/':'')+segments.join('/')]);
}
export function migratePrototypeSaved(saved = {}) {
  const next={...saved}, candidates=new Map();
  for(const [key,value] of Object.entries(saved)) {
    let identity;try{identity=JSON.parse(key);}catch{continue;}
    if(!Array.isArray(identity)||identity.length!==3||!identity.every(v=>typeof v==='string'))continue;
    const destination=documentKey([{id:'old',hostId:identity[0],path:identity[1]}],fileKey('old',identity[2]));
    if(!candidates.has(destination))candidates.set(destination,[]);
    candidates.get(destination).push(value);
  }
  for(const [key,values] of candidates)if(!(key in next)&&values.every(v=>v===values[0]))next[key]=values[0];
  return next;
}
export function fileScenario(state, key = state.active) {
  return state.fileStates?.[key]?.scenario || 'ready';
}
export function setFileScenario(state, key, scenario, diskText) {
  if (!key) return state;
  return { ...state, fileStates: { ...state.fileStates, [key]: {
    ...state.fileStates?.[key], scenario,
    ...(diskText !== undefined ? { diskText } : {})
  } } };
}
export function editDraft(state, key, text, base) {
  if (state.tabs.find(t => fileKey(t.root, t.path) === key)?.attachment) return state;
  if (!state.tabs.some(t => fileKey(t.root, t.path) === key)) return state;
  const previous = state.drafts[key];
  if (previous?.text === text || (!previous && text === base)) return state;
  if (fileScenario(state,key) === 'input-interrupted') state = setFileScenario(state,key,'ready');
  if (text === (previous?.base ?? base) && fileScenario(state,key) !== 'conflict') {
    const drafts = {...state.drafts}; delete drafts[key];
    return {...state,drafts,revisions:{...state.revisions,[key]:(state.revisions?.[key]||0)+1}};
  }
  return { ...state,
    drafts: { ...state.drafts, [key]: { text, base: state.drafts[key]?.base ?? base } },
    revisions: { ...state.revisions, [key]: (state.revisions?.[key] || 0) + 1 },
    tabs: state.tabs.map(t => fileKey(t.root, t.path) === key ? { ...t, preview: false } : t)
  };
}
export function openDocument(state, roots, root, path, pin=false) {
  const identity=documentKey(roots,fileKey(root,path));
  const alias=identity && state.tabs.find(t=>documentKey(roots,fileKey(t.root,t.path))===identity);
  return openFile(state,alias?.root||root,alias?.path||path,pin);
}
// The visible tree can intentionally lag external fixture changes. Opening a
// cached result still revalidates against the synthetic disk projection; it
// must not consume those changes or retarget the neighboring result.
export function openVerifiedDocument(state, roots, root, path, pin=false, defaults=FILES) {
  const next = openDocument(state, roots, root, path, pin);
  const pending = state.pendingFiles?.[root]?.length || state.pendingDirectoryChanges?.[root]?.length;
  const disk = pending ? refreshSyntheticDirectory(state, root, defaults) : state;
  const available = prototypeDirectoryFiles(disk, root, defaults).find(file => file.path === path);
  if (!available || available.kind === 'missing' || disk.retiredFiles?.[fileKey(root, path)]) return setFileScenario(next, fileKey(root, path), 'missing');
  return next;
}
// Labelled prototype fixture completion: background restored documents become
// ready while the current user selection, draft and root remain untouched.
export function completeSyntheticFileRestores(state) {
  return state.tabs.reduce((next, tab) => {
    const key = fileKey(tab.root, tab.path);
    return fileScenario(next, key) === 'loading' ? setFileScenario(next, key, 'ready') : next;
  }, state);
}
export function completeSyntheticWorkspaceRestores(store) {
  let changed = false;
  const entries = Object.entries(store).map(([scope, state]) => {
    const next = Array.isArray(state?.tabs) ? completeSyntheticFileRestores(state) : state;
    changed ||= next !== state;
    return [scope, next];
  });
  return changed ? Object.fromEntries(entries) : store;
}
export function prototypeCloseContext(state, key, scope) {
  return { scope, key, tab: state.tabs.find(tab => fileKey(tab.root, tab.path) === key), draft: state.drafts[key] };
}
export function prototypeCloseIsCurrent(state, context, scope) {
  return Boolean(context?.tab && context.scope === scope && state.tabs.includes(context.tab) && state.drafts[context.key] === context.draft);
}
export function prototypeModeSwitchContext(state, key, scope, intent, target) {
  return { ...prototypeCloseContext(state, key, scope), intent, target, from: state.mode[key] || 'render' };
}
/** Explicit delayed-save demo only; production uses the real save promise. */
export function completePrototypeModeSwitch(store, scope, roots, context, intent) {
  const state = store[scope];
  if (!state || !prototypeCloseIsCurrent(state, context, scope) || (state.mode[context.key] || 'render') !== context.from) return { store, result: 'stale' };
  const current = state.active === context.key && context.intent === intent;
  const outcome = commitDraft(store, scope, roots, context.key);
  if (outcome.result !== 'saved' || !current) return outcome;
  const next = outcome.store[scope];
  return { ...outcome, store: { ...outcome.store, [scope]: { ...next, mode: { ...next.mode, [context.key]: context.target } } } };
}
export function readRootView(state, root=state.root) {
  return {expanded:['docs'],selected:[],query:'',focused:'AGENTS.md',scrollTop:0,searchScrollTop:0,...state.rootStates?.[root]};
}
export function updateRootView(state, patch, root=state.root) {
  return {...state,rootStates:{...state.rootStates,[root]:{...readRootView(state,root),...patch}}};
}
export function commitDraft(store, taskId, roots, key, { override = false } = {}) {
  const state = store[taskId];
  if (state?.tabs.find(t => fileKey(t.root, t.path) === key)?.attachment) return { store, result: 'readonly' };
  if (!state?.drafts[key]) return { store, result: 'clean' };
  const scenario = fileScenario(state, key);
  if (state.retiredFiles?.[key] || ['missing','root-missing','unreadable'].includes(scenario)) return { store, result: 'missing' };
  if (scenario === 'conflict' && !override) return { store, result: 'conflict' };
  if (scenario === 'save-error') return { store, result: 'save-error' };
  if (scenario === 'input-interrupted') return { store, result: 'input-interrupted' };
  const identity = documentKey(roots, key);
  if (!identity) return { store, result: 'missing-root' };
  const disk = store.saved?.[identity];
  if (!override && disk !== undefined && disk !== state.drafts[key].base && disk !== state.drafts[key].text) {
    return { result: 'conflict', store: { ...store, [taskId]: setFileScenario(state, key, 'conflict', disk) } };
  }
  const drafts = { ...state.drafts };
  const value = drafts[key].text;
  delete drafts[key];
  const next = setFileScenario({ ...state, drafts }, key, 'ready');
  return { result: 'saved', store: { ...store, [taskId]: next, saved: { ...store.saved, [identity]: value } } };
}
export function acceptDisk(state, key) {
  const drafts = { ...state.drafts };
  delete drafts[key];
  return setFileScenario({ ...state, drafts,
    revisions: { ...state.revisions, [key]: (state.revisions?.[key] || 0) + 1 },
    reloads: { ...state.reloads, [key]: (state.reloads?.[key] || 0) + 1 }
  }, key, 'ready');
}
export function continueConflict(state, key) {
  const draft = state.drafts?.[key], disk = state.fileStates?.[key]?.diskText;
  if (!draft || disk === undefined || fileScenario(state, key) !== 'conflict') return state;
  return setFileScenario({ ...state, drafts: { ...state.drafts, [key]: { ...draft, base: disk } } }, key, 'ready');
}
export function captureSelection({ scope, identity, revision, text, start, end }) {
  if (!identity || start < 0 || end <= start || end > text.length) return null;
  return { scope, identity, revision, start, end, source: text, text: text.slice(start, end) };
}
export function selectionIsCurrent(selection, { scope, identity, revision, text }) {
  return !!selection && selection.scope === scope && selection.identity === identity && selection.revision === revision && selection.source === text;
}

// Independent synthetic disk event: no CLI request, attribution, approval or rollback.
export function applyExternalFileChange(store, scope, roots, key, diskText) {
  const state = store[scope], identity = documentKey(roots, key);
  if (!state || !identity) return store;
  const draft = state.drafts[key];
  let next = { ...state, revisions: { ...state.revisions, [key]: (state.revisions?.[key] || 0) + 1 } };
  if (draft?.text === diskText) next = acceptDisk(state, key);
  else next = setFileScenario(next, key, draft && draft.base !== diskText ? 'conflict' : 'ready', diskText);
  return { ...store, saved: { ...store.saved, [identity]: diskText }, [scope]: next };
}

// A staged fixture models external directory changes that a refresh can observe.
export function queueSyntheticFile(state, root, file) {
  return { ...state, pendingFiles: { ...state.pendingFiles, [root]: [...(state.pendingFiles?.[root] || []).filter(f => f.path !== file.path), file] } };
}
export function prototypeDirectoryFiles(state, root, defaults = FILES) {
  const removed = new Set(state.removedPaths?.[root] || []), byPath = new Map(defaults.map(file => [file.path, file]));
  for (const file of state.syntheticFiles?.[root] || []) byPath.set(file.path, file);
  return [...byPath.values()].filter(file => !removed.has(file.path));
}
export function queueSyntheticDirectoryChanges(state, root, changes) {
  return { ...state, pendingDirectoryChanges: { ...state.pendingDirectoryChanges, [root]: [...(state.pendingDirectoryChanges?.[root] || []), ...changes] } };
}
export function refreshSyntheticDirectory(state, root, defaults = FILES) {
  const pending = state.pendingFiles?.[root] || [];
  const byPath = new Map((state.syntheticFiles?.[root] || []).map(file => [file.path, file]));
  const visible = new Map(prototypeDirectoryFiles(state, root, defaults).map(file => [file.path, file]));
  const removed = new Set(state.removedPaths?.[root] || []), retired = { ...state.retiredFiles };
  const version = (state.directoryRevisions?.[root] || 0) + 1;
  let next = state;
  const identity = file => file.syntheticId || 'initial:' + root + ':' + file.path;
  const retire = path => {
    const file = visible.get(path), key = fileKey(root, path);
    if (file && next.tabs.some(tab => fileKey(tab.root, tab.path) === key)) {
      if (!retired[key]) retired[key] = { ...file, syntheticId: identity(file) };
      next = setFileScenario(next, key, 'missing');
      next = { ...next, revisions: { ...next.revisions, [key]: (next.revisions?.[key] || 0) + 1 } };
    }
    visible.delete(path); byPath.delete(path); removed.add(path);
  };
  const put = (file, newIdentity = true) => {
    if (newIdentity && visible.has(file.path)) retire(file.path);
    const value = newIdentity ? { ...file, syntheticId: 'external:' + root + ':' + version + ':' + file.path } : file;
    visible.set(value.path, value); byPath.set(value.path, value); removed.delete(value.path);
    return value;
  };
  for (const file of pending) put(file, Boolean(retired[fileKey(root, file.path)]));
  for (const change of state.pendingDirectoryChanges?.[root] || []) {
    if (change.type === 'delete') retire(change.path);
    else if (change.type === 'create') put(change.file);
    else if (change.type === 'rename') {
      const file = visible.get(change.from); if (!file) continue;
      const originalId = identity(file); retire(change.from);
      if (visible.has(change.to)) retire(change.to);
      put({ ...file, path: change.to, syntheticId: originalId }, false);
    } else if (change.type === 'restore') {
      const value = put(change.file, false), key = fileKey(root, value.path);
      if (retired[key] && identity(value) === identity(retired[key])) { delete retired[key]; next = setFileScenario(next, key, 'ready'); }
    }
  }
  return { ...next, retiredFiles: retired, removedPaths: { ...next.removedPaths, [root]: [...removed] }, directoryRevisions: { ...next.directoryRevisions, [root]: version }, syntheticFiles: { ...next.syntheticFiles, [root]: [...byPath.values()] }, pendingFiles: { ...next.pendingFiles, [root]: [] }, pendingDirectoryChanges: { ...next.pendingDirectoryChanges, [root]: [] } };
}
export function refreshSyntheticDirectoryStore(store, scope, roots, root, defaults = FILES) {
  const state = store[scope]; if (!state) return store;
  const changed = [...(state.pendingFiles?.[root] || []).map(file => file.path), ...(state.pendingDirectoryChanges?.[root] || []).flatMap(change => change.type === 'rename' ? [change.to] : change.file ? [change.file.path] : [])];
  const next = refreshSyntheticDirectory(state, root, defaults), visible = new Map(prototypeDirectoryFiles(next, root, defaults).map(file => [file.path, file])), saved = { ...store.saved };
  for (const path of changed) { const file = visible.get(path), id = documentKey(roots, fileKey(root, path)); if (file && id) saved[id] = file.text ?? ''; }
  return { ...store, saved, [scope]: next };
}
export function retrySyntheticFile(state, root, path, defaults = FILES) {
  const key = fileKey(root, path), file = prototypeDirectoryFiles(state, root, defaults).find(file => file.path === path), retired = state.retiredFiles?.[key];
  if (!file) return { state, result: 'missing' };
  if (retired && (retired.syntheticId || 'initial:' + root + ':' + path) !== (file.syntheticId || 'initial:' + root + ':' + path)) return { state, result: 'changed-file' };
  const retiredFiles = { ...state.retiredFiles }; delete retiredFiles[key];
  return { state: setFileScenario({ ...state, retiredFiles }, key, 'ready'), result: 'ready' };
}

export function artifactModel(value = '') {
  let initial;
  try { initial = JSON.parse(value); } catch { initial = {}; }
  if (!initial || typeof initial !== 'object') initial = {};
  const defaultCells = [['阶段', '名称', '状态'], ['M8', '项目导入导出', '已完成'], ['M9', '文件浏览工作区', '设计中'], ['M10', '定时任务', '待规划']];
  const validCells = cells => Array.isArray(cells) && cells.length && cells.every(row => Array.isArray(row) && row.length);
  const cells = cells => (validCells(cells) ? cells : defaultCells).map(row => row.map(v => String(v ?? '')));
  return {
    slides: [0, 1, 2].map(i => ({ title: String(initial.slides?.[i]?.title ?? (i === 0 ? initial.title || '文件浏览工作区' : i === 1 ? '每一项需求都有依据' : '评审与交付')) })),
    comments: Array.isArray(initial.comments) ? initial.comments.map(String) : [],
    sheets: [0, 1].map(i => ({ name: i === 0 ? '需求' : '验收', cells: cells(initial.sheets?.[i]?.cells ?? (i === 0 ? initial.cells : undefined)) }))
  };
}
export function updateArtifactCell(model, sheet, row, column, value) {
  return { ...model, sheets: model.sheets.map((s, i) => i === sheet ? { ...s, cells: s.cells.map((r, j) => j === row ? r.map((v, k) => k === column ? value : v) : r) } : s) };
}
export function updateArtifactSlide(model, slide, title) {
  return { ...model, slides: model.slides.map((s, i) => i === slide ? { ...s, title } : s) };
}
export function initialWorkspace() {
  return {
    root: 'main',
    tabs: [{
      root: 'main',
      path: 'AGENTS.md',
      preview: false
    }],
    active: fileKey('main', 'AGENTS.md'),
    closed: [],
    drafts: {},
    fileStates: {},
    revisions: {},
    reloads: {},
    expanded: ['docs'],
    mode: {},
    width: 250,
    tree: true
  };
}
export function openFile(state, root, path, pin = false) {
  const key = fileKey(root, path),
    existing = state.tabs.find(t => fileKey(t.root, t.path) === key);
  if (existing) return {
    ...state,
    active: key,
    // Activation is not a new document instance. Preserve its identity when
    // pinning would leave the preview flag unchanged (pending saves own it).
    tabs: state.tabs.map(t => t === existing && t.preview !== (t.preview && !pin) ? {
      ...t,
      preview: t.preview && !pin
    } : t)
  };
  const tab = {
      root,
      path,
      preview: !pin
    },
    preview = state.tabs.findIndex(t => t.preview && !state.drafts[fileKey(t.root, t.path)]);
  const tabs = [...state.tabs];
  if (preview >= 0) tabs[preview] = tab;else tabs.push(tab);
  return {
    ...state,
    tabs,
    active: key
  };
}
export function closeFile(state, key) {
  const index = state.tabs.findIndex(t => fileKey(t.root, t.path) === key);
  if (index < 0) return state;
  const tab = state.tabs[index],
    tabs = state.tabs.filter(t => fileKey(t.root, t.path) !== key);
  const retiredFiles = { ...state.retiredFiles }, fileStates = { ...state.fileStates };
  if (retiredFiles[key]) { delete retiredFiles[key]; delete fileStates[key]; }
  return {
    ...state,
    ...(state.retiredFiles?.[key] ? { retiredFiles, fileStates } : {}),
    tabs,
    active: state.active === key ? tabs[Math.min(index, tabs.length - 1)] ? fileKey(tabs[Math.min(index, tabs.length - 1)].root, tabs[Math.min(index, tabs.length - 1)].path) : null : state.active,
    closed: tab.attachment ? state.closed : [{
      ...tab,
      index
    }, ...state.closed].slice(0, 25)
  };
}
export function restoreFile(state) {
  const [tab, ...closed] = state.closed;
  if (!tab) return state;
  if (state.tabs.some(t => fileKey(t.root, t.path) === fileKey(tab.root, tab.path))) return { ...openFile(state, tab.root, tab.path, true), closed };
  const next = openFile(state, tab.root, tab.path, true);
  const pdf = pdfReadingHint(state.tabs.find(t => fileKey(t.root, t.path) === fileKey(tab.root, tab.path))?.pdf || tab.pdf);
  const tabs = next.tabs.filter(t => fileKey(t.root, t.path) !== fileKey(tab.root, tab.path));
  tabs.splice(Math.min(tab.index, tabs.length), 0, {
    root: tab.root,
    path: tab.path,
    preview: false,
    ...(pdf ? { pdf } : {})
  });
  return {
    ...next,
    tabs,
    closed
  };
}
function pdfReadingHint(value) {
  return value && Number.isSafeInteger(value.page) && value.page >= 1 && Number.isFinite(value.zoom) && value.zoom >= 30 && value.zoom <= 800 ? { page: value.page, zoom: value.zoom } : null;
}
export function updatePdfReading(state, key, value) {
  const pdf = pdfReadingHint(value), tab = state.tabs.find(t => fileKey(t.root, t.path) === key);
  if (!pdf || !tab || tab.pdf?.page === pdf.page && tab.pdf?.zoom === pdf.zoom) return state;
  return { ...state, tabs: state.tabs.map(t => t === tab ? { ...t, pdf } : t) };
}
export function treeRows(files, expanded, query = '') {
  const paths = [...files.map(f => f.path), ...EMPTY_DIRS];
  const rows = new Map();
  for (const path of paths) {
    const parts = path.split('/');
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join('/');
      if (!rows.has(p)) rows.set(p, {
        path: p,
        name,
        depth: i,
        folder: i < parts.length - 1 || EMPTY_DIRS.includes(p)
      });
    });
  }
  return [...rows.values()].filter(r => query ? !r.folder && r.path.toLowerCase().includes(query.toLowerCase()) : r.path.split('/').slice(0, -1).every((_, i) => expanded.includes(r.path.split('/').slice(0, i + 1).join('/')))).sort((a, b) => {
    const ap = a.path.split('/'),
      bp = b.path.split('/');
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      if (ap[i] === bp[i]) continue;
      if (!ap[i]) return -1;
      if (!bp[i]) return 1;
      const ad = ap.slice(0, i + 1).join('/'),
        bd = bp.slice(0, i + 1).join('/');
      return Number(rows.get(bd)?.folder) - Number(rows.get(ad)?.folder) || ap[i].localeCompare(bp[i], 'zh');
    }
    return 0;
  });
}
// 树的 ARIA 位置：同一父目录下的兄弟序号与总数（仅统计当前可见行）。
export { treeSetInfo } from '../../../src/shared/file-tree-scroll.mjs';
