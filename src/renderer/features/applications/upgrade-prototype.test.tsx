// @vitest-environment jsdom
// Prototype component U only; no browser, packaged App or visual acceptance.
import {useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
// @ts-expect-error Shared approved prototype is JavaScript.
import {PackageUpgradePreview} from '@root/prototypes/m6-codex/src/IntegrationPackageUI.jsx';
// @ts-expect-error Shared synthetic prototype model is JavaScript.
import {initialIntegrationState,projectIntegrationState} from '@root/prototypes/m6-codex/src/integration-model.mjs';

beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{cleanup();vi.useRealTimers();});
it('keeps synthetic defaults unchanged for blocked/unknown preflight and upgrades only after a ready check',()=>{
 let current=projectIntegrationState(initialIntegrationState());
 function Harness(){const[data,setData]=useState(current);current=data;return <PackageUpgradePreview data={data} setData={setData}/>;}
 render(<Harness/>);const before=structuredClone(current);
 for(const scene of ['blocked','unavailable']){
  fireEvent.change(screen.getByRole('combobox',{name:'升级预检场景'}),{target:{value:scene}});
  if(scene==='blocked')for(const text of ['邮件 v1.0.0 · 原版本','会话：邮件汇总（示例）','连接：本地邮件（示例）','动作范围：读取邮件、正文及附件（依赖此连接的部分）'])expect(screen.getByText(text)).toBeTruthy();
  else expect(screen.getByText('升级状态无法核验')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));act(()=>vi.advanceTimersByTime(1000));expect(current).toEqual(before);expect(screen.getByText('预检尚未通过，原默认版本和历史保留。')).toBeTruthy();
 }
 fireEvent.change(screen.getByRole('combobox',{name:'升级预检场景'}),{target:{value:'ready'}});fireEvent.click(screen.getByRole('button',{name:'模拟升级并保留数据'}));expect(current.packages).toEqual(before.packages);act(()=>vi.advanceTimersByTime(450));expect(current.packages).toEqual({zentao:'1.1.0',mail:'1.1.0'});expect(current.connections).toEqual(before.connections);expect(current.bindings).toEqual(before.bindings);
});
