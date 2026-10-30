// @vitest-environment jsdom
import {cleanup,render} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import type {OfficeFloatingVector} from '@shared/file-office';
import {WorkbookChart} from './workbook-chart-svg';
afterEach(()=>cleanup());
const object=(type:NonNullable<OfficeFloatingVector['chart']>['type'],values:(number|null)[],x?:(number|null)[]):OfficeFloatingVector=>({id:'chart',kind:'chart',name:'Actual selected values',source:{part:'xl/charts/one.xml',id:'1'},anchor:{kind:'absoluteAnchor',position:{x:0,y:0},extent:{width:320,height:180}},chart:{type,categories:values.map((_,i)=>String(i+1)),series:[{name:'Series',values}],x}});
it('keeps a missing line value as two segments and no invented zero marker',()=>{
 const view=render(<WorkbookChart object={object('line',[1,null,3])}/>);expect(view.container.querySelectorAll('circle')).toHaveLength(2);expect(view.container.querySelectorAll('polyline')).toHaveLength(2);expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});
it('leaves missing scatter X/Y unplotted and uses stable finite coordinates for extreme finite values',()=>{
 const view=render(<WorkbookChart object={object('scatter',[1e308,2,-1e308],[1e308,null,-1e308])}/>);expect(view.container.querySelectorAll('circle')).toHaveLength(2);expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});
it('handles empty/zero pie values and finite values whose naive sum would overflow',()=>{
 const view=render(<WorkbookChart object={object('pie',[null,0,0])}/>);expect(view.container.textContent).toContain('没有可绘制的数值');expect(view.container.querySelectorAll('path')).toHaveLength(0);view.rerender(<WorkbookChart object={object('pie',[1e308,1e308,null])}/>);expect(view.container.querySelectorAll('path')).toHaveLength(2);expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
});
