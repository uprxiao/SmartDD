// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
// @ts-expect-error standalone synthetic JSX prototype
import {PrototypeAttachment} from '../../../../prototypes/m6-codex/src/PrototypeAttachment.jsx';
// @ts-expect-error standalone synthetic JSX prototype
import {PrototypeHtmlPreview} from '../../../../prototypes/m6-codex/src/PrototypeResourceView.jsx';
const body='合成附件正文：核对项目进展与待办。未读取真实文件。';
afterEach(cleanup);
function open(){render(<PrototypeAttachment/>);fireEvent.click(screen.getByRole('button',{name:'查看附件文字'}));expect(screen.getByText(body)).toBeTruthy();fireEvent.click(screen.getByText('内容读取演示 · 仅合成'));}
it('SR P keeps only this opening partial content while continuation fails and retries',()=>{
 window.localStorage.setItem('sr-resource-sentinel','unchanged');open();
 fireEvent.click(screen.getByLabelText('启用分块内容演示'));
 expect(screen.queryByText(body)).toBeNull();
 fireEvent.click(screen.getByLabelText('下次内容读取失败'));
 fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));
 expect(screen.getByText('合成资源暂时不可读，请核对后重试。')).toBeTruthy();
 const partial=document.querySelector('.m10-resource-view pre')!.textContent;
 fireEvent.click(screen.getByLabelText('暂存内容读取'));
 fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));
 expect(screen.queryByText('合成资源暂时不可读，请核对后重试。')).toBeNull();
 expect(screen.queryByRole('button',{name:'重试'})).toBeNull();
 expect(document.querySelector('.m10-resource-view pre')!.textContent).toBe(partial);
 expect(screen.getByRole('button',{name:'继续读取内容'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'交回内容读取 · 合成'}));
 expect(screen.getByText(body)).toBeTruthy();expect(screen.queryByRole('button',{name:'继续读取内容'})).toBeNull();
 expect(window.localStorage.getItem('sr-resource-sentinel')).toBe('unchanged');
});
it('SR P explicit revalidation hides old text and error until the current first read finishes',()=>{
 open();fireEvent.click(screen.getByLabelText('暂存内容读取'));fireEvent.click(screen.getByLabelText('下次内容读取失败'));
 fireEvent.click(screen.getByRole('button',{name:'重新核对内容 · 合成'}));
 expect(screen.getByText('正在读取原内容…')).toBeTruthy();expect(screen.queryByText(body)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'交回内容读取 · 合成'}));
 expect(screen.getByText('内容读取未完成')).toBeTruthy();expect(screen.queryByText(body)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'重试'}));
 expect(screen.getByText('正在读取原内容…')).toBeTruthy();expect(screen.queryByRole('button',{name:'重试'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'交回内容读取 · 合成'}));
 expect(screen.getByText(body)).toBeTruthy();expect(screen.getByRole('button',{name:'交回内容读取 · 合成'})).toHaveProperty('disabled',true);
});
it('SR P collapsing HTML discards its held read and reopens with a fresh owner',async()=>{
 render(<PrototypeHtmlPreview/>);expect(document.querySelector('.m10-prototype-resource')).toBeNull();
 const summary=screen.getByText('HTML 正文 · 安全文本预览');fireEvent.click(summary);
 await screen.findByText('内容读取演示 · 仅合成');fireEvent.click(screen.getByText('内容读取演示 · 仅合成'));
 fireEvent.click(screen.getByLabelText('暂存内容读取'));fireEvent.click(screen.getByRole('button',{name:'重新核对内容 · 合成'}));
 expect(screen.getByText('正在读取原内容…')).toBeTruthy();fireEvent.click(summary);
 await screen.findByText('HTML 正文 · 安全文本预览');
 await waitFor(()=>expect(document.querySelector('.m10-prototype-resource')).toBeNull());
 fireEvent.click(summary);await screen.findByText('内容读取演示 · 仅合成');
 expect(screen.getByRole('button',{name:'交回内容读取 · 合成'})).toHaveProperty('disabled',true);
 expect(screen.getByLabelText('暂存内容读取')).toHaveProperty('checked',false);
});
