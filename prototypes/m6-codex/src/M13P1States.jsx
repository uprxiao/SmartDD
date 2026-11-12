// P1 design-only states. No RPC, native terminal, credential or network access.
import React, {useState} from 'react';
import {ShieldAlert,TriangleAlert} from 'lucide-react';

export const P1_SCENES = [
  ['p1-write-pending','P1 · 终端写操作等待确认'],
  ['p1-write-expired','P1 · 写操作确认已过期'],
  ['p1-write-stale','P1 · 原连接变化、确认失效'],
  ['p1-write-busy','P1 · 写操作确认处理中'],
  ['p1-write-unknown','P1 · 写操作结果未知'],
  ['p1-write-channel-error','P1 · 确认通道不可用'],
  ['p1-migration-failed','P1 · 禅道迁移失败、保留内置'],
  ['p1-migration-uncertain','P1 · 禅道迁移状态待核查'],
  ['p1-default-missing','P1 · 全局默认连接缺失'],
];

export function P1MigrationNotice({scene}) {
  if(!['p1-migration-failed','p1-migration-uncertain'].includes(scene))return null;
  return <div className="m13-alert danger" role="alert"><TriangleAlert size={16}/><div>
    <strong>{scene==='p1-migration-failed'?'禅道迁移未完成':'禅道迁移状态需要恢复核查'}</strong>
    <p>{scene==='p1-migration-failed'?'仍保留原内置功能和数据；下次启动会重新尝试。':'已保留原数据；请重新启动后核对。'}</p>
    <small>演示 · 合成失败状态，不会迁移或重启真实应用。</small>
  </div></div>;
}

export function P1WritePreview({scene}) {
  const [decision,setDecision]=useState(null),[retried,setRetried]=useState(false);
  const channelError=scene==='p1-write-channel-error'&&!retried,expired=scene==='p1-write-expired',stale=scene==='p1-write-stale',busy=scene==='p1-write-busy',unknown=scene==='p1-write-unknown';
  const decide=allow=>{if(busy||allow&&(expired||stale))return;setDecision(allow?'allowed':'denied');};
  return <div className="m13-p1-preview">
    <header><h1>终端写操作确认</h1><p>设计原型 · 合成任务／账号。下面的输入区不是实际 CLI；按钮不会执行任何插件操作。</p></header>
    <section className="m13-p1-terminal" aria-label="P1 合成终端">
      <div className="m13-p1-terminal-head">Demo Tracker · 任务 A <span>合成终端</span></div>
      <pre className="m13-p1-terminal-output">{'› 在测试账号一中新建待办\n\n等待你确认本次插件写操作。'}</pre>
      <label className="m13-p1-input">模拟终端输入<textarea aria-label="模拟终端输入" placeholder="这里可以输入；Enter 不会批准操作"/></label>
      {channelError?<div className="m13-p1-review" role="alert">插件操作确认暂不可用：界面通道不可用。<button className="m10-button secondary" onClick={()=>setRetried(true)}>重试</button></div>
        :unknown?<div className="m13-p1-review" role="alert"><h2>操作结果未知</h2><p>操作已提交，但未取得明确结果。请核对操作记录和目标系统，不要重复提交。</p><p className="m13-hint">演示操作编号：P1-synthetic-operation。原型不提供自动重发。</p></div>
        :decision?<div className="m13-p1-review" role="status">{decision==='allowed'?'已允许这一次（演示）；仅记录一次合成决定，没有执行真实操作。':'已拒绝（演示）；插件零执行。'}</div>
        :<section className="m13-p1-review" role="dialog" aria-modal="false" aria-label="确认本次插件写操作" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();decide(false);}}}>
          <header><ShieldAlert size={18}/><h2>确认本次插件写操作</h2></header>
          <p>Demo Tracker · v0.1.0 · 新增待办</p><p className="m13-hint">demo-tracker.items.add · 可能修改数据 · 仅本次操作</p>
          <dl><dt>目标</dt><dd>测试账号一（tracker / synthetic-account-one）</dd><dt>本次输入</dt><dd><pre>{JSON.stringify({title:'P1 合成待办 · 中文🙂',description:'确认当前账号与完整输入；包含长文本时可滚动查看。\n'+('合成说明，勿自动重发。'.repeat(20))},null,2)}</pre></dd></dl>
          <p className="m13-hint">拒绝时不执行。允许后仅执行一次；异常结果不会自动重发。{expired?'此确认已过期。':busy?'正在处理这一次决定。':'剩余 60 秒（演示暂停计时）。'}</p>
          {stale&&<p className="m13-danger" role="alert">原连接已变化，本次确认已失效。需重新发起操作并重新审阅。</p>}
          <footer><button className="m10-button secondary" disabled={busy} onClick={()=>decide(false)}>拒绝</button><button className="m10-button primary" disabled={busy||expired||stale} onClick={()=>decide(true)}>{busy?'正在处理…':'允许这一次'}</button></footer>
        </section>}
    </section>
  </div>;
}
