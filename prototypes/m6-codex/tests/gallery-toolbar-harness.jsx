import React,{useState}from'react';
import{createRoot}from'react-dom/client';
import{ImageGallery}from'../src/ImageGallery.jsx';
import corpus from'./markdown-images-fixtures.json';
import'../src/styles.css';
const wide=corpus.find(x=>x.name==='wide.png'),tall=corpus.find(x=>x.name==='tall.png');
const make=(x,name,alt)=>({id:name,name,alt,src:x.dataUrl});
function Harness(){
  const[theme,setTheme]=useState('light'),[gallery,setGallery]=useState(null);document.documentElement.dataset.theme=theme;
  const open=mode=>{const pictures=mode==='multi'?[make(wide,'wide.png','Wide original'),make(tall,'tall.png','Tall original')]:[make(wide,'single.png','Only original')];setGallery({picture:pictures[0],pictures});};
  const download=picture=>{const link=document.createElement('a');link.href=picture.src;link.download=picture.name;link.click();};
  return <><header><strong>P · V11 直接旧灯箱 · 仅合成 PNG，无任务/文件系统/剪贴板</strong><button data-testid="gallery-theme" onClick={()=>setTheme(x=>x==='light'?'dark':'light')}>主题 {theme}</button><button data-testid="open-multi" onClick={()=>open('multi')}>打开多图</button><button data-testid="open-single" onClick={()=>open('single')}>打开单图</button></header>{gallery&&<ImageGallery initial={gallery} overlay={false} download onClose={()=>setGallery(null)} onDownload={download}/>}</>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
