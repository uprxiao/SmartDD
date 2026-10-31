import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspace } from '../src/FileWorkspace.jsx';
import { FILES, initialWorkspace, workspaceScope } from '../src/file-workspace-model.mjs';
import '../src/styles.css';
const sha = 'a'.repeat(40), base = 'https://github.com/willyou-m9-fixture/location-links';
const configs = [
  { id: 'https', url: base + '.git', commit: sha },
  { id: 'ssh', url: 'git@github.com:willyou-m9-fixture/location-links.git', commit: sha },
  { id: 'foreign', url: 'https://example.invalid/public-fixture/repository', commit: sha },
  { id: 'missing', url: null, commit: sha },
  { id: 'credentials', url: 'https://public-placeholder:public-placeholder@github.com/fixture/repository', commit: sha },
  { id: 'scheme', url: 'javascript:alert(1)', commit: sha },
  { id: 'uncommitted', url: base, commit: '0'.repeat(40) },
];
const text = 'PUBLIC PROTOTYPE LOCATION LINE\nPUBLIC SECOND LINE\n';
function App() {
  const [theme, setTheme] = useState('light'), [config, setConfig] = useState(configs[0]), [opens, setOpens] = useState([]);
  document.documentElement.dataset.theme = theme;
  const id = 'E17-P-' + theme + '-' + config.id, path = '/synthetic/' + id;
  const roots = [{ id: 'main', hostId: 'local', path }, { id: 'extra', hostId: 'local', path: '/workspace/shared-docs' }];
  const key = workspaceScope(id, roots), existing = JSON.parse(localStorage.getItem('willyou-m9-prototype-v1') || '{}');
  if (!existing[key]) localStorage.setItem('willyou-m9-prototype-v1', JSON.stringify({ ...existing, [key]: { ...initialWorkspace(), tabs: [], active: null, expanded: [], removedPaths: { main: FILES.map(f => f.path) }, syntheticFiles: { main: [{ path: 'location.txt', kind: 'code', text }] } } }));
  return <><header style={{ height: 82, padding: 8, boxSizing: 'border-box', font: '12px system-ui' }}><strong>P · E17 合成仓库链接；点击只记录网页打开意图，不访问网络</strong><div>{['light', 'dark'].map(t => <button key={t} data-theme-choice={t} onClick={() => setTheme(t)}>{t}</button>)}{configs.map(c => <button key={c.id} data-case-choice={c.id} onClick={() => setConfig(c)}>{c.id}</button>)}</div><output data-opens={JSON.stringify(opens)} data-case={config.id} data-theme={theme}>已记录 {opens.length} 次合成打开</output></header><main style={{ display: 'flex', height: 'calc(100vh - 82px)' }}><FileWorkspace key={id} task={{ id, cwd: path, hostId: 'local', status: 'running' }} project={{ id: 'E17', name: 'P 合成仓库', path, hostId: 'local' }} dark={theme === 'dark'} onTheme={() => {}} onClose={() => {}} repositoryWebUrl={config.url} repositoryCommitId={config.commit} onRepositoryLink={href => setOpens(previous => [...previous, { href, theme, config: config.id }])} /></main></>;
}
createRoot(document.getElementById('root')).render(<App />);
