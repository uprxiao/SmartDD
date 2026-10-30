import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspaceTree } from '../src/FileWorkspaceTree.jsx';
import { initialWorkspace, openFile, fileKey } from '../src/file-workspace-model.mjs';
import '../src/styles.css';
import '../src/file-workspace.css';
// Only this standalone harness owns these synthetic rows. The shared production
// prototype tree and tab-state model are imported without replacement.
const files = Object.entries({
  '.env': 'ACCEPTANCE_SYNTHETIC=true\n', '.gitignore': 'node_modules/\n', '.hidden/x': 'hidden child\n',
  'node_modules/x': 'ordinary tree includes dependencies\n',
  'level1/level2/level3/level4/level5/leaf.txt': 'five-level lazy fixture\n',
  'A.txt': 'Tree A baseline\n', 'B.txt': 'Tree B baseline\n',
}).map(([path, text]) => ({ path, text, kind: 'code' }));
function Harness() {
  const [state, setState] = useState(() => ({ ...initialWorkspace(), tabs: [], active: null, expanded: [] }));
  const [selected, setSelected] = useState([]), [focused, setFocused] = useState('');
  const scrollRef = useRef(null), apiRef = useRef(null);
  const active = state.tabs.find(tab => fileKey(tab.root, tab.path) === state.active);
  return <main className="file-workspace" style={{height:700,width:1100,margin:24,display:'flex',gap:24}}>
    <section style={{width:340,height:650,display:'flex',flexDirection:'column'}} aria-label="原型树组件验收">
      <h1>合成 D02 文件树</h1><p>原型样本，未读取本机目录</p>
      <FileWorkspaceTree files={files} scope="tree-basic-harness" rootPath="/synthetic/D02" query="" searchScenario="ready"
        expanded={state.expanded} selected={selected} focused={focused} activePath={active?.path} scrollRef={scrollRef} apiRef={apiRef}
        onScrollPosition={()=>{}} onExpandedChange={expanded=>setState(old=>({...old,expanded}))} onSelectedChange={setSelected} onFocusedChange={setFocused}
        onOpen={(path,pin)=>setState(old=>openFile(old,'main',path,pin))} onMenu={()=>{}} onDrag={event=>event.preventDefault()} onDragEnd={()=>{}}
        changedOnly={false} hideGenerated={false} large={false} renderIcon={()=>null} />
    </section>
    <section aria-label="原型 openFile 状态观测"><h2>标签模型结果</h2>
      <ul aria-label="当前标签">{state.tabs.map(tab=><li key={fileKey(tab.root,tab.path)} data-preview={String(tab.preview)}>{tab.path} · {tab.preview?'预览':'固定'}</li>)}</ul>
      <pre aria-label="当前文件正文">{files.find(file=>file.path===active?.path)?.text??'尚未打开'}</pre>
      <p>空目录使用共享原型已有 fixtures/空目录，未新造文件节点。</p>
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
