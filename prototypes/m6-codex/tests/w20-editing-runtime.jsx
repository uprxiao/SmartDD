// Independent synthetic fixture; no file provider/native source or persistence.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {FileOfficePreview} from '../src/FileOfficePreview.jsx';
import {createOfficeHistory} from '../src/file-office-model.mjs';
import '../src/styles.css';
const theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light';
document.documentElement.dataset.theme=theme;
const model=createOfficeHistory('xlsx','').doc;model.sheets[0].cells[1][1]='3';
window.__w20P={theme,states:[],drafts:[],initial:model};
createRoot(document.getElementById('root')).render(<main style={{position:'fixed',inset:0,display:'flex',flexDirection:'column'}}><aside style={{height:30,flexShrink:0}}>P · W20 合成工作簿 · 仅受影响inline键盘回归</aside><div id="w20-P" style={{flex:1,minHeight:0,display:'flex'}}><FileOfficePreview kind="xlsx" path="W20-synthetic.xlsx" initialValue={JSON.stringify(model)} onStateChange={state=>window.__w20P.states.push(state)} onDraft={value=>window.__w20P.drafts.push(JSON.parse(value))}/></div></main>);
