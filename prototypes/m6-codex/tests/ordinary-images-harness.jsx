import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspace } from '../src/FileWorkspace.jsx';
import { initialWorkspace, workspaceScope, FILES } from '../src/file-workspace-model.mjs';
import corpus from './ordinary-images-fixtures.json';
import '../src/styles.css';
window.__ordinaryImagesPrototype = { kind: 'Five synthetic images in original shared FileWorkspace, no real file/terminal/model access', cases: corpus };
function Fixture({ theme }) {
  const [id] = useState(() => {
    const id = 'ordinary-images-' + theme, path = '/synthetic/' + id;
    const roots = [{ id: 'main', hostId: 'local', path }, { id: 'extra', hostId: 'local', path: '/workspace/shared-docs' }];
    const scope = workspaceScope(id, roots), state = JSON.parse(localStorage.getItem('willyou-m9-prototype-v1') || '{}');
    state[scope] = { ...initialWorkspace(), tabs: [], active: null, expanded: [], rootStates: { main: { expanded: [], query: '', selected: [], focused: '', scrollTop: 0 } }, removedPaths: { main: FILES.map(x => x.path) }, syntheticFiles: { main: corpus.map(x => ({ path: x.name, kind: x.svg ? 'svg' : 'image', text: x.svg ? atob(x.dataUrl.split(',')[1]) : x.dataUrl })) } };
    localStorage.setItem('willyou-m9-prototype-v1', JSON.stringify(state)); return id;
  });
  return <FileWorkspace task={{ id, cwd: '/synthetic/' + id, hostId: 'local', status: 'running' }} project={{ id: 'ordinary-images-P', path: '/synthetic/' + id, name: 'Ordinary images P', hostId: 'local' }} dark={theme === 'dark'} onTheme={() => {}} onClose={() => {}} />;
}
function Harness() {
  const [theme, setTheme] = useState('light'); document.documentElement.dataset.theme = theme;
  return <><style>{'.ordinary-images-harness>.file-workspace{width:100%!important;height:100%!important;max-width:none!important;margin:0!important;flex:1!important}'}</style><nav style={{ height: 40 }}>P · 合成图片 · 无真实文件或终端<button data-testid="image-theme" onClick={() => setTheme(x => x === 'light' ? 'dark' : 'light')}>主题</button></nav><section className="ordinary-images-harness" style={{ position: 'fixed', top: 40, left: 0, bottom: 0, width: 'min(1200px,100vw)', display: 'flex' }}><Fixture key={theme} theme={theme} /></section></>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness /></StrictMode>);
