import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileOfficePreview } from '../src/FileOfficePreview';
import '../src/styles.css';

function App() {
  const [theme, setTheme] = useState('light'), [mode, setMode] = useState('default');
  document.documentElement.dataset.theme = theme;
  const wide = mode === 'wide' ? { sourceState: 'live', sourceBytes: true, canRead: true, canWrite: true, manualEditing: true, manualEditUiEnabled: true, annotationsEnabled: true, hasRedlines: true, redlinesEnabled: true } : {};
  return <><header style={{ height: 80, boxSizing: 'border-box', padding: 8, font: '12px system-ui' }}><strong>P · W06 合成 DOCX 文件宿主，仅测试共享组件，不读取 Office 原件</strong><div>{['light', 'dark'].map(x => <button data-w06-theme={x} key={x} onClick={() => setTheme(x)}>{x}</button>)}{['default', 'wide'].map(x => <button data-w06-mode={x} key={x} onClick={() => setMode(x)}>{x}</button>)}</div><output data-w06-status data-theme={theme} data-mode={mode} /></header><main style={{ height: 'calc(100vh - 80px)' }}><FileOfficePreview key={`${theme}/${mode}`} kind="docx" path="/synthetic/W06-readonly.docx" hostOptions={wide} onDraft={text => { window.__w06Drafts ??= []; window.__w06Drafts.push(text); }} onStateChange={state => { window.__w06State = { ...JSON.parse(JSON.stringify(state)), scene: `${theme}/${mode}` }; }} /></main></>;
}
createRoot(document.getElementById('root')).render(<App />);
