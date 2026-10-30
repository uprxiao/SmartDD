import React from 'react';
import { createRoot } from 'react-dom/client';
import FileRecoveryPrototype from '../src/FileRecoveryPrototype';
import '../src/styles.css';
import '../src/file-workspace.css';
const dark = new URLSearchParams(location.search).get('theme') === 'dark';
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
createRoot(document.getElementById('root')).render(<main className={dark ? 'app dark' : 'app'}><FileRecoveryPrototype onClose={() => { document.getElementById('root').textContent = 'Recovery prototype closed'; }}/></main>);
