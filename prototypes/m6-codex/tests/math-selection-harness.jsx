import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileMarkdown } from '../src/FileMarkdown.jsx';
import '../src/styles.css';
const templates = {
  paragraph: '中文😀 $a^2$ 与 $b_1$', heading: '  ## 中文😀 $a^2$ 与 $b_1$', quote: '> 中文😀 $a^2$ 与 $b_1$', list: '- 中文😀 $a^2$ 与 $b_1$',
  block: '$$\r\na+b\r\n$$', 'quote-block': '> $$\r\n> a+b\r\n> $$', 'list-block': '- $$\r\n  a+b\r\n  $$', eqno: '$$a+b$$ (eq-1)',
};
function Harness() {
  const [mode, setMode] = useState('paragraph'), [text, setText] = useState(''), [seq, setSeq] = useState(0), [selection, setSelection] = useState(null), [theme, setTheme] = useState('light');
  document.documentElement.dataset.theme = theme;
  const choose = value => { setMode(value); setText(['# Prefix', '', templates[value], '', 'Other $z$', '', 'Tail', ''].join('\r\n')); setSeq(old => old + 1); };
  return <main style={{padding:24,height:'100vh'}}><p>公式源码选区 · P合成夹具。编辑目标公式，保留相邻公式。无真实文件或服务。</p><nav style={{display:'flex',gap:8}}>{Object.keys(templates).map(value => <button key={value} data-testid={'selection-' + value} onClick={() => choose(value)}>{value}</button>)}<button data-testid="selection-theme" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>浅深色</button><button data-testid="selection-blur">失焦</button></nav><output data-testid="selection-log">{JSON.stringify({mode, text, selection})}</output><section style={{height:650,overflow:'auto'}}><FileMarkdown key={seq} text={text} path={mode + '.md'} onEdit={setText} onSelect={(from,to) => setSelection({from,to})}/></section></main>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
