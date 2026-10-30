import React,{useState}from 'react';
import{createRoot}from 'react-dom/client';
import{FileOfficePreview}from '../src/FileOfficePreview';
import '../src/styles.css';
const report={total:2,issues:[{kind:'missing',part:'customXml/vbaProject.bin',message:'非预期缺失'},{kind:'changed',part:'customXml/layout.xml',message:'与本次合法编辑后的内容不一致'}]};
function App(){
 const[theme,setTheme]=useState('light'),[kind,setKind]=useState('xlsx'),[mode,setMode]=useState('blocked'),[receipt,setReceipt]=useState('cancelled'),[copies,setCopies]=useState([]);document.documentElement.dataset.theme=theme;
 return <><header style={{font:'12px system-ui',height:92,padding:8,boxSizing:'border-box'}}><strong>P · Y13 合成保真状态；另存只返回模拟回执，不访问文件系统或导出 Office</strong><div>{['light','dark'].map(x=><button data-theme-choice={x} key={x} onClick={()=>setTheme(x)}>{x}</button>)}{['xlsx','pptx','docx'].map(x=><button data-kind-choice={x} key={x} onClick={()=>setKind(x)}>{x}</button>)}{['blocked','signed','ordinary'].map(x=><button data-mode-choice={x} key={x} onClick={()=>setMode(x)}>{x}</button>)}{['cancelled','saved','failed'].map(x=><button data-receipt-choice={x} key={x} onClick={()=>setReceipt(x)}>{x}</button>)}</div><output data-copy-count={copies.length} data-theme={theme} data-kind={kind} data-mode={mode}>{JSON.stringify(copies)}</output></header><main style={{height:'calc(100vh - 92px)'}}><FileOfficePreview key={`${theme}/${kind}/${mode}/${receipt}`} kind={kind} path={`/synthetic/P-Y13-${kind}`} hostOptions={{manualEditing:true,signed:mode==='signed',fidelityFailure:mode==='blocked'?report:undefined,onSaveLossyCopy:async()=>{setCopies(rows=>[...rows,{theme,kind,receipt}]);if(receipt==='failed')throw Error('Synthetic copy unavailable');return{state:receipt};}}}/></main></>;
}
createRoot(document.getElementById('root')).render(<App/>);
