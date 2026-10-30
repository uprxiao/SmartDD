import React,{StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ImageGallery} from '../src/ImageGallery.jsx';
import corpus from './gallery-keyboard-fixtures.json';
import '../src/styles.css';
const pictures=['wide.png','tall.png','transparent.png'].map((name,id)=>({id,alt:['A','B','C'][id],src:corpus.find(x=>x.name===name).dataUrl}));
// Plain fixture nodes intentionally have no second React ancestry: keyboard
// events reach the real shared gallery's delegated handler. This is a P-only
// conditional-target adapter, not additional controls in the production App.
const targets=`<fieldset class="keys-fixture" aria-label="P 合成键盘目标"><legend>P · 合成条件控件，仅检验共享键盘策略</legend>
<label>input<input data-guard="input" value="Original field text"></label>
<label>textarea<textarea data-guard="textarea">Original field text</textarea></label>
<label>select<select data-guard="select"><option>A</option><option>B</option></select></label>
<div tabindex="0" contenteditable="true" data-guard="editable-true">editable true</div>
<div tabindex="0" contenteditable data-guard="editable-empty">editable empty</div>
<div tabindex="0" contenteditable="plaintext-only" data-guard="editable-plaintext">editable plaintext</div>
<div tabindex="0" role="menu" data-guard="menu">menu</div><div tabindex="0" role="slider" data-guard="slider">slider</div>
<div tabindex="0" role="spinbutton" data-guard="spinbutton">spinbutton</div><div tabindex="0" role="combobox" data-guard="combobox">combobox</div>
<div tabindex="0" role="listbox" data-guard="listbox">listbox</div><div tabindex="0" role="grid" data-guard="grid">grid</div>
<div tabindex="0" role="tree" data-guard="tree">tree</div><div tabindex="0" role="tablist" data-guard="tablist">tablist</div>
<button data-guard="prevented">child prevents default</button>
<div contenteditable="true"><div tabindex="0" contenteditable="false" data-guard="noneditable-island">noneditable island</div></div></fieldset>`;
function Harness(){
 const [open,setOpen]=useState(false),[theme,setTheme]=useState('light');document.documentElement.dataset.theme=theme;
 useEffect(()=>{if(!open)return;const viewport=document.querySelector('.fw-gallery-viewport'),template=document.createElement('template');template.innerHTML=targets;const fixture=template.content.firstElementChild;viewport.append(fixture);const button=fixture.querySelector('[data-guard=prevented]'),prevent=event=>event.preventDefault();button.addEventListener('keydown',prevent);return()=>{button.removeEventListener('keydown',prevent);fixture.remove();};},[open]);
 return <><style>{'.keys-fixture{position:absolute;left:16px;top:16px;z-index:3;display:grid;grid-template-columns:repeat(4,minmax(90px,1fr));gap:8px;max-width:640px;padding:12px;background:var(--bg-elevated,#fff);color:var(--text-primary,#222);font:12px system-ui}.keys-fixture>*{min-width:0;padding:4px;border:1px solid #888;border-radius:4px}.keys-fixture input,.keys-fixture textarea,.keys-fixture select{display:block;width:100%;max-width:130px;font:12px system-ui}.keys-fixture textarea{height:30px}'}</style><nav>P · 灯箱键盘条件，控件为独立测试夹具；无真实文件或系统输入法候选<button data-testid="keys-theme" onClick={()=>setTheme(t=>t==='light'?'dark':'light')}>主题</button></nav><button data-testid="keys-open" onClick={()=>setOpen(true)}>Source image B</button>{open&&<ImageGallery initial={{picture:pictures[1],pictures}} overlay={false} download={false} onDownload={()=>{throw Error('Keyboard fixture does not provide download')}} onClose={()=>setOpen(false)}/>}</>;
}
createRoot(document.getElementById('root')).render(<StrictMode><Harness/></StrictMode>);
