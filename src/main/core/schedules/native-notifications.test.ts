import {EventEmitter} from 'node:events';
import type {Notification,NotificationConstructorOptions} from 'electron';
import {describe,expect,it,vi} from 'vitest';
import type {ScheduleNotice} from './service';
import {ScheduleNativeNotifications} from './native-notifications';

class NativeNotice extends EventEmitter {
  show=vi.fn();
  constructor(readonly id:string,readonly options:NotificationConstructorOptions){super();}
}
const notice=(key='notice-1',status='failed'):ScheduleNotice=>({key,planId:'plan-'+key,runId:'run-'+key,taskId:null,turnId:null,requestId:null,status,title:'A scheduled task',createdAt:1,deliveredAt:null});
function fixture(overrides:Partial<ConstructorParameters<typeof ScheduleNativeNotifications>[0]>={}){
  let next=0;
  // The fixture holds the native event source, rather than simulating a click
  // with a scheduling RPC. The active owner separately retains the object.
  const source:NativeNotice[]=[],open=vi.fn(async()=>{}),error=vi.fn();
  const create=vi.fn((options:NotificationConstructorOptions)=>{const n=new NativeNotice(String(++next),options);source.push(n);return n as unknown as Notification;});
  const presenter=new ScheduleNativeNotifications({create,open,error,...overrides});
  return{presenter,source,create,open,error};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

describe('native schedule notification ownership',()=>{
  it('keeps the actual native notification after the banner times out, and routes a later actual click once',async()=>{
    let settle!:()=>void;const open=vi.fn(()=>new Promise<void>(resolve=>{settle=resolve;})),f=fixture({open}),shown=vi.fn();
    f.presenter.show(notice(),shown);const n=f.source[0];expect(f.presenter.activeCount).toBe(1);expect(n.show).toHaveBeenCalledOnce();
    n.emit('show',{});n.emit('show',{});expect(shown).toHaveBeenCalledOnce();
    n.emit('close',{reason:'timedOut'});expect(f.presenter.activeCount).toBe(1);
    n.emit('click',{});n.emit('click',{});expect(open).toHaveBeenCalledExactlyOnceWith({planId:'plan-notice-1',runId:'run-notice-1'});
    expect(f.presenter.activeCount).toBe(1);settle();await flush();expect(f.presenter.activeCount).toBe(0);
  });
  it('preserves exact waiting task and request, and never opens a duplicate or dismissed notice',async()=>{
    const f=fixture(),waiting={...notice('two','waiting'),taskId:'task-2',turnId:'turn-2',requestId:'request-2'};
    f.presenter.show(waiting,vi.fn());f.presenter.show(waiting,vi.fn());expect(f.create).toHaveBeenCalledTimes(1);
    f.source[0].emit('click',{});await flush();expect(f.open).toHaveBeenCalledExactlyOnceWith({planId:'plan-two',runId:'run-two',taskId:'task-2',turnId:'turn-2',requestId:'request-2'});
    f.presenter.show(notice('three'),vi.fn());f.source[1].emit('close',{reason:'userCanceled'});f.source[1].emit('click',{});
    expect(f.presenter.activeCount).toBe(0);expect(f.open).toHaveBeenCalledTimes(1);
  });
  it('keeps an ambiguous close until actual OS history establishes absence, without dismissing other notifications',async()=>{
    let now=0;const delivered=vi.fn(async()=>new Set(['own-present','unrelated']));
    const f=fixture({now:()=>now,history:delivered,pruneThreshold:2});
    f.presenter.show(notice('old'),vi.fn());f.source[0].emit('show',{});f.source[0].emit('close',{});expect(f.presenter.activeCount).toBe(1);
    // Only the old notification qualifies for pruning; a just-shown notice
    // cannot be evicted based on a slightly earlier OS history snapshot.
    now=60_000;f.presenter.show(notice('fresh'),vi.fn());f.source[1].emit('show',{});await flush();
    expect(delivered).toHaveBeenCalledOnce();expect(f.presenter.activeCount).toBe(1);
    f.source[0].emit('click',{});expect(f.open).not.toHaveBeenCalled();
    f.source[1].emit('click',{});await flush();expect(f.open).toHaveBeenCalledExactlyOnceWith({planId:'plan-fresh',runId:'run-fresh'});
  });
  it('releases a native failure, catches route failure, and prevents new side effects after shutdown',async()=>{
    const open=vi.fn(async()=>{throw new Error('shell unavailable');}),f=fixture({open});
    f.presenter.show(notice('failure'),vi.fn());f.source[0].emit('failed',{},'no notification');expect(f.presenter.activeCount).toBe(0);
    f.presenter.show(notice('repair','repair'),vi.fn());f.source[1].emit('click',{});await flush();expect(f.error).toHaveBeenCalledOnce();expect(f.presenter.activeCount).toBe(0);
    f.presenter.show(notice('pending'),vi.fn());f.presenter.dispose();f.source[2].emit('click',{});f.presenter.show(notice('late'),vi.fn());
    expect(f.presenter.activeCount).toBe(0);expect(f.create).toHaveBeenCalledTimes(3);expect(open).toHaveBeenCalledTimes(1);
  });
});
