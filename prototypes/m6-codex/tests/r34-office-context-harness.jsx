import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileArtifactPreview } from '../src/FileArtifactPreview.jsx';
import '../src/styles.css';
import '../src/file-workspace.css';

// No PTY/model/Office bytes: observe the real route adapter's insertion contract.
const fixture = window.officeContextProbe = { calls: [], replies: [], pending: {}, states: [], submitted: 0 };
async function insert(text, metadata) {
  const id = fixture.calls.length;
  fixture.calls.push({ id, text, metadata });
  const reply = fixture.replies.length ? fixture.replies.shift() : { status: 'inserted' };
  if (reply?.defer) return new Promise(resolve => { fixture.pending[id] = resolve; });
  if (reply?.throw) throw new Error('controlled insertion acknowledgement lost');
  return reply;
}
fixture.resolve = (id, result) => {
  const resolve = fixture.pending[id];
  if (!resolve) throw new Error(`No pending insertion ${id}`);
  delete fixture.pending[id];
  resolve(result);
};
function Harness() {
  const [config, setConfig] = useState({ visible: false, kind: 'pptx', path: '/synthetic/演示 文档.pptx', adapter: true, generation: 0 });
  fixture.show = next => setConfig(previous => ({ ...previous, ...next, generation: next.reset ? previous.generation + 1 : previous.generation }));
  return <main style={{ height: '94vh', width: 1120, display: 'flex', margin: '16px auto', overflow: 'hidden' }}>
    {config.visible && <FileArtifactPreview key={config.generation} kind={config.kind} path={config.path}
      hostOptions={{ annotationsEnabled: true, docxRoute: 'legacy', manualEditing: true }}
      onInsertContext={config.adapter ? insert : undefined}
      onStateChange={state => { fixture.states.push(state); fixture.state = state; }} />}
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness />);
