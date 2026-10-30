import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspace } from '../src/FileWorkspace.jsx';
import { initialWorkspace, workspaceScope, FILES } from '../src/file-workspace-model.mjs';
import corpus from './markdown-images-fixtures.json';
import '../src/styles.css';
const contexts = [{ scope: 'other', context: false }, { scope: 'other', context: true }, { scope: 'document', context: false }];
window.__markdownImagesPrototype = { syntheticOnly: true, contexts };
function Fixture({ theme, context }) {
  const [id] = useState(() => {
    const id = 'markdown-images-' + theme + '-' + context, path = '/synthetic/' + id;
    const roots = [{ id: 'main', hostId: 'local', path }, { id: 'extra', hostId: 'local', path: '/workspace/shared-docs' }];
    const scope = workspaceScope(id, roots), state = JSON.parse(localStorage.getItem('willyou-m9-prototype-v1') || '{}');
    const text = '# 嵌入图示例\n\n![宽图](wide.png)\n\n![高图](tall.png)\n\n![动画](animated.gif)\n';
    state[scope] = { ...initialWorkspace(), tabs: [], active: null, expanded: [], rootStates: { main: { expanded: [], query: '', selected: [], focused: '', scrollTop: 0 } }, removedPaths: { main: FILES.map(x => x.path) }, syntheticFiles: { main: [{ path: 'images.md', kind: 'markdown', text }, ...corpus.map(x => ({ path: x.name, kind: 'image', text: x.dataUrl }))] } };
    localStorage.setItem('willyou-m9-prototype-v1', JSON.stringify(state)); return id;
  });
  return <FileWorkspace imageMenuScope={contexts[context].scope} imageContext={contexts[context].context} task={{ id, cwd: '/synthetic/' + id, hostId: 'local', status: 'running' }} project={{ id: 'markdown-images-P', path: '/synthetic/' + id, name: 'Embedded images P', hostId: 'local' }} dark={theme === 'dark'} onTheme={() => {}} onClose={() => {}} />;
}
function Harness() {
  const [theme, setTheme] = useState('light'), [context, setContext] = useState(0); document.documentElement.dataset.theme = theme;
  return <><style>{'.markdown-images-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{ height: 40, display: 'flex', gap: 12 }}>P · 合成嵌图，无真实任务输入/文件读取<button data-testid="image-theme" onClick={() => setTheme(x => x === 'light' ? 'dark' : 'light')}>主题</button><button data-testid="image-context" onClick={() => setContext(x => (x + 1) % 3)}>上下文 {context}</button></nav><section className="markdown-images-harness" style={{ position: 'fixed', top: 40, left: 0, bottom: 0, width: 'min(1200px,100vw)', display: 'flex' }}><Fixture key={theme + context} theme={theme} context={context} /></section></>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
