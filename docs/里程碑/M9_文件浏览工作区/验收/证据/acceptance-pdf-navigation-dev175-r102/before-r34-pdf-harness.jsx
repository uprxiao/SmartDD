import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilePdfPreview } from '../src/FilePdfPreview.jsx';
import { FileNotebookPreview } from '../src/FileNotebookPreview.jsx';
import { createPdfSession, pdfRuntimeSnapshot } from '../src/file-pdf-engine.mjs';
import '../src/styles.css';
import '../src/file-workspace.css';
window.r34 = { createPdfSession, snapshot: pdfRuntimeSnapshot, states: [], insertions: [], replies: [], instances: 0 };
function Harness() {
  const [config, setConfig] = useState({ kind: 'none' });
  window.r34.show = value => { window.r34.instances++; setConfig({ ...value, instance: window.r34.instances }); };
  return <main style={{ height: '94vh', width: 1000, display: 'flex', margin: '0 auto', overflow: 'hidden' }}>
    {config.kind === 'notebook' ? <FileNotebookPreview key={config.instance} initialValue={config.value} /> : config.kind !== 'none' && <FilePdfPreview key={config.instance} kind={config.kind || 'pdf'} path="fixture.pdf"
      hostOptions={{ pdfSource: config.source || 'normal', annotationBatchingEnabled: true }}
      onStateChange={value => { window.r34.state = value; }}
      onInsertContext={async (text, metadata) => { window.r34.insertions.push({ text, metadata }); const value = window.r34.replies.shift() || { status: 'inserted' }; await new Promise(resolve => setTimeout(resolve, value.delay || 0)); return value; }} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);
