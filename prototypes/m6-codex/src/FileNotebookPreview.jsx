import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Play } from 'lucide-react';
import { notebookFixture, notebookFrameDocument, parseNotebook } from './file-artifact-model.mjs';
import { renderMarkdownReadOnly } from './file-markdown-model.mjs';
import { highlightCode } from './file-highlight.mjs';
import './file-artifact.css';
import '../../../src/shared/markdown-readonly.css';
import 'katex/dist/katex.min.css';
import { createMarkdownMathBudget, createMarkdownMathSession, hydrateMarkdownMath } from '../../../src/shared/markdown-math-session.mjs';

// 只读 Markdown：与文档同一 markdown-it 管线（html 关闭、链接不导航、图片白名单）。
function StaticMarkdown({ text }) {
  const html = useMemo(() => renderMarkdownReadOnly(text), [text]);
  const root = useRef(null);
  useEffect(() => { const math = createMarkdownMathSession(), abort = new AbortController(), release = hydrateMarkdownMath(root.current, math, abort.signal, { budget: createMarkdownMathBudget(html.length), overflow: () => { root.current.textContent = text; } }); return () => { abort.abort(); release(); math.dispose(); }; }, [html, text]);
  return <div ref={root} className="fa-static-markdown" onClick={event => { const link = event.target.closest('a'); if (link) event.preventDefault(); }} dangerouslySetInnerHTML={{ __html: html }} />;
}
function CodeBlock({ source, label, copy = true, language }) {
  const [copied, setCopied] = useState(false), [failed, setFailed] = useState(false);
  const highlighted = useMemo(() => language ? highlightCode(source, language) : { html: null }, [source, language]);
  const copyText = async () => {
    try { await navigator.clipboard.writeText(source); setCopied(true); setFailed(false); }
    catch { setFailed(true); }
  };
  return <div className="fa-code-block">{copy && <header><span>{label}</span><button className="fw-icon" aria-label={'复制 ' + label} onClick={copyText}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></header>}{highlighted.html !== null ? <pre><code className="hljs" data-language={highlighted.language} dangerouslySetInnerHTML={{ __html: highlighted.html }} /></pre> : <pre>{source}</pre>}{failed && <p role="status">复制失败，请选择原文复制。</p>}</div>;
}
const RawOutput = ({ text }) => <details className="fa-raw-output"><summary>Raw output</summary><pre>{text}</pre></details>;
function ImageOutput({ output }) {
  const [failed, setFailed] = useState(false);
  return <div className="fa-notebook-image"><img src={output.dataUrl} alt={'Notebook output ' + output.outputNumber} onError={() => setFailed(true)} />{failed && <p role="status">图片输出无法显示。</p>}</div>;
}
function NotebookOutput({ output }) {
  const document = useMemo(() => output.type === 'html' ? notebookFrameDocument(output.text) : '', [output]);
  if (output.type === 'image') return <ImageOutput output={output} />;
  if (output.type === 'html') return <div><iframe className="fa-notebook-frame" title="Notebook HTML output" sandbox="" referrerPolicy="no-referrer" srcDoc={document} /><RawOutput text={output.text} /></div>;
  if (output.type === 'markdown') return <StaticMarkdown text={output.text} />;
  if (output.type === 'error') {
    const title = output.evalue ? output.ename + ': ' + output.evalue : output.ename;
    const raw = (output.ename + ': ' + output.evalue).trim() + (output.traceback.trim() ? '\n' + output.traceback : '');
    return <div className="fa-notebook-error-output">{output.summaryMarkdown ? <StaticMarkdown text={output.summaryMarkdown} /> : <strong>{title}</strong>}{raw.trim() && <RawOutput text={raw} />}</div>;
  }
  if (output.summaryMarkdown) return <div className="fa-notebook-summary"><StaticMarkdown text={output.summaryMarkdown} /><RawOutput text={output.text} /></div>;
  return output.type === 'json' ? <CodeBlock source={output.text} label="JSON" copy={false} language="json" /> : <pre className="fa-notebook-output">{output.text}</pre>;
}
function NotebookCell({ cell, index, total }) {
  const source = cell.source.trim() ? <CodeBlock source={cell.source} label={cell.type === 'raw' ? 'Raw' : 'Python'} language={cell.type === 'raw' ? null : 'python'} /> :
    <p className="fa-notebook-empty">{cell.type === 'raw' ? 'Empty raw cell' : 'Empty code cell'}</p>;
  return <details className="fw-notebook-cell fa-notebook-cell" open>
    <summary><span title={cell.title}>{cell.title}</span><small>Cell {index + 1} of {total}</small>{cell.type === 'code' && <span className="fa-notebook-execution">{cell.executionCount !== null && <small>Run {cell.executionCount}</small>}<span className="fw-notebook-run" title="Running is disabled in read-only preview" aria-hidden="true"><Play size={12} /></span></span>}</summary>
    <div className="fa-notebook-cell-body">{cell.type === 'markdown' ? cell.source.trim() ? <StaticMarkdown text={cell.source} /> : <p className="fa-notebook-empty">Empty Markdown cell</p> : <>
      {cell.description && <StaticMarkdown text={cell.description} />}{cell.sourceCollapsed && cell.source.trim() ? <details className="fa-code-disclosure"><summary>Code</summary>{source}</details> : source}
    </>}</div>
    {cell.outputs.length > 0 && <div className="fa-notebook-outputs">{cell.outputs.map((output, i) => <NotebookOutput key={i} output={output} />)}</div>}
  </details>;
}

export function FileNotebookPreview({ initialValue, title = 'Notebook.ipynb', onDownload = () => {}, hostOptions = {} }) {
  const [scenario, setScenario] = useState(hostOptions.notebookScenario || 'current');
  const source = scenario === 'current' ? (initialValue ?? notebookFixture()) : notebookFixture(scenario);
  const document = useMemo(() => parseNotebook(source, title), [source, title]);
  return <div className="fw-artifact fa-notebook">
    <div className="fw-artifact-tools"><strong>{document.title}</strong><small>{document.status === 'ready' ? document.cells.length + ' 个单元' : 'IPYNB'}</small><span className="fw-push" /><button className="fw-icon" aria-label="下载 Notebook 示例" onClick={onDownload}><Download size={16} /></button></div>
    <div className="fa-notebook-scroll">{document.status === 'error' ? <div className="fw-empty" role="alert"><h3>无法预览 Notebook</h3><p>{document.error}</p></div> : !document.cells.length ? <div className="fw-empty">This notebook does not contain any cells</div> : <div className="fa-notebook-cells">{document.cells.map((cell, i) => <NotebookCell key={scenario + ':' + cell.id + ':' + i} cell={cell} index={i} total={document.cells.length} />)}</div>}</div>
    <details className="fa-fixture-controls"><summary>M9 Notebook 场景（模拟）</summary><label>示例数据<select aria-label="Notebook 示例场景" value={scenario} onChange={e => setScenario(e.target.value)}>{[['current', '当前传入内容'], ['all', '所有 cell / MIME 分支'], ['empty', '无单元'], ['invalid-json', 'JSON 解析失败'], ['invalid-schema', '单元结构不合法']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p>不运行代码、Vega 或输出脚本。HTML 输出禁脚本、网络和导航；Markdown 使用与文档相同的 CommonMark 渲染（原始 HTML 转义、链接不导航），代码用 highlight.js 高亮。</p></details>
  </div>;
}
