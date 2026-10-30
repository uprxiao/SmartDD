// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ApplicationImpactView} from './impact';
import type {useApplicationImpact} from './api';
type Query=ReturnType<typeof useApplicationImpact>;
const query=(checkedAt:string,extra:Record<string,unknown>={}):Query=>({data:{kind:'remove',appId:'mail',checkedAt,connections:[],projects:[],runs:[]},isPending:false,isFetching:false,error:null,refetch:vi.fn(),...extra} as unknown as Query);
afterEach(cleanup);
describe('PK impact time uses the same human display and preserves raw provenance',()=>{
 it('keeps the original machine-readable timestamp while rendering the approved local minute',()=>{const raw=new Date(2026,0,1,3,4,59,987).toISOString();const v=render(<ApplicationImpactView query={query(raw)}/>);expect(screen.getByText('2026-01-01 03:04')).toBeTruthy();expect(v.container.querySelector('time')?.dateTime).toBe(raw)});
 it('distinguishes an invalid source time from a checked instant',()=>{render(<ApplicationImpactView query={query('2026-02-30T00:00:00Z')}/>);expect(screen.getByText('时间不可用')).toBeTruthy();expect(screen.queryByText(/Invalid Date/)).toBeNull()});
 it('marks a missing audit time as unrecorded',()=>{render(<ApplicationImpactView query={query('')}/>);expect(screen.getByText('未记录')).toBeTruthy()});
 it('does not expose cached time while impact verification is still pending',()=>{const v=render(<ApplicationImpactView query={query('2026-01-01T00:00:00Z',{isFetching:true})}/>);expect(screen.getByText('正在核对影响范围…')).toBeTruthy();expect(v.container.querySelector('time')).toBeNull()});
 it('keeps failed verification separate from any former checked time',()=>{const v=render(<ApplicationImpactView query={query('2026-01-01T00:00:00Z',{error:new Error('本次核对失败')})}/>);expect(screen.getByText('本次核对失败')).toBeTruthy();expect(v.container.querySelector('time')).toBeNull()});
});
