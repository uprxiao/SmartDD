import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileWorkspace } from '../src/FileWorkspace.jsx';
import '../src/styles.css';
const variants = {
  local: { hostId: 'local', cwd: '/synthetic/M07' },
  host: { hostId: 'synthetic-ssh', cwd: '/synthetic/M07' },
  path: { hostId: 'local', cwd: '/synthetic/M07', remotePath: '/synthetic/M07' },
  uri: { hostId: 'local', cwd: 'ssh://fixture.invalid/synthetic/M07' },
};
function Harness() {
  const [source, setSource] = useState('local'), [dark, setDark] = useState(false), [closed, setClosed] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const task = { id: 'm07-source-harness', title: 'M07 synthetic', ...variants[source] };
  const project = { id: 'm07-synthetic', name: 'M07 合成项目', path: '/synthetic/M07', servers: [{ hostId: 'synthetic-ssh', host: 'fixture.invalid' }] };
  return <main className="m07-harness" style={{padding:24}}>
    <style>{'.m07-harness .file-workspace{width:100%;height:100%;margin-top:0}'}</style>
    <header><h1>M07 来源隔离 · 原型合成数据</h1><p>有 SSH 配置的本机项目；所有样本均不连接网络、不读取真实文件。</p>
      <label>测试来源<select aria-label="测试来源" value={source} onChange={event => { setSource(event.target.value); setClosed(false); }}><option value="local">本机</option><option value="host">非本机 host，同绝对路径</option><option value="path">remotePath，同绝对路径</option><option value="uri">SSH URI</option></select></label>
      <button onClick={() => setDark(value => !value)}>切换浅深色</button>
      <p role="status">记录保留：local / host / path / uri，共 4 个合成描述；当前 {source}</p>
    </header>
    {closed ? <p>已关闭文件区，记录保留</p> : <div style={{height:700,position:'relative',width:1100}}><FileWorkspace task={task} project={project} dark={dark} onTheme={() => setDark(value => !value)} onClose={() => setClosed(true)}/></div>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
