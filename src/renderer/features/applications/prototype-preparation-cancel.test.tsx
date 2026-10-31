// @vitest-environment jsdom
import {useState} from 'react';
import {flushSync} from 'react-dom';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
// @ts-expect-error Shared isolated prototype is JavaScript.
import {ReferenceHome} from '@root/prototypes/m6-codex/src/ReferenceHome.jsx';
afterEach(cleanup);
// Match the actual browser discrete-event commit before its default form action.
function mount(preparing:boolean){const submitted=vi.fn(),cancelled=vi.fn();function State(){const[waiting,setWaiting]=useState(preparing),[prompt,setPrompt]=useState('OU original input');return <ReferenceHome project={{id:'own',name:'Own synthetic project',dirs:[]}} projects={[]} profile={{id:'own-profile',name:'Own profile'}} profiles={[]} prompt={prompt} setPrompt={setPrompt} dir={{available:true,id:'own-dir',label:'Own directory'}} preparing={waiting} onCancelPreparation={()=>{cancelled();flushSync(()=>setWaiting(false));}} onSubmit={submitted}/>;}render(<State/>);return{submitted,cancelled};}
it('OU-01 cancel never submits the form when its button changes from cancel to launch in the same click',()=>{const{submitted,cancelled}=mount(true);fireEvent.click(screen.getByRole('button',{name:'取消准备'}));expect(cancelled).toHaveBeenCalledOnce();expect(submitted).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'任务描述'})).toHaveProperty('value','OU original input');expect(screen.getByRole('button',{name:'启动任务'})).toBeTruthy();});
it('still submits exactly once when launch is explicitly clicked after a cancellation',()=>{const{submitted}=mount(true);fireEvent.click(screen.getByRole('button',{name:'取消准备'}));submitted.mockClear();fireEvent.click(screen.getByRole('button',{name:'启动任务'}));expect(submitted).toHaveBeenCalledOnce();});
