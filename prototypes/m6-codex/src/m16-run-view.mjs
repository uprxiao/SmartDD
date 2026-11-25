// F16 P1.1: recorded, synthetic turn snapshots for the run-detail prototype.
// Production reads the original task/turn, never generates a result from a prompt.
export const REVIEW_RUNS = {run:'seed-1', completed:'seed-1', skipped:'seed-2', failed:'seed-3', waiting:'seed-4', running:'seed-running', partial:'seed-partial', monthly:'seed-5', unknown:'seed-unknown'};

const daily = {
  summary:'本轮整理了研发进展，识别出 2 项需要继续推进的工作。',
  markdown:[
    '已整理项目近期提交和未完成事项。下面是本次研发摘要。',
    '**已完成**',
    '- 合并近期 Bug 修复，同步功能开发与 bugfix 分支。',
    '- 更新 Antigravity 接入说明，保留旧执行器的回归验证记录。',
    '**待推进**',
    '- 定时任务：确认运行记录和结果查看交互后，再进入实现。',
    '- 浏览器：补充真实登录站点的专项验收。',
    '**下一步建议**',
    '先完成定时任务的原型评审与用例核对，再安排正式开发和回归测试。',
  ],
  artifacts:[{name:'研发摘要.md',path:'reports/研发摘要.md',text:'研发摘要（合成示例）\n\n已完成：Bug 修复合并、执行器接入说明更新。\n待推进：定时任务评审、浏览器真实站点验收。\n下一步：确认原型和验收范围。'}],
};
const monthly = {
  summary:'已将学习笔记整理为 3 类主题，并形成下月阅读清单。',
  markdown:['本月知识整理已完成。','**主题归档**','- Agent 工具与工作流','- 产品原型与交互','- 测试验证记录','**下月阅读清单**','继续关注任务调度、浏览器协作和多 Agent 使用体验。'],
  artifacts:[],
};
const progress = ['已读取本次示例中的需求记录。','初步整理出 2 项待跟进事项；仍需核对其状态，当前不是最终结论。'];
const evt = (kind,label,detail,at) => ({kind,label,detail,at});
const launchEvent = run => evt('start','任务已启动','收到任务和本次回合回执。',run.startedAt);

export function initialPreviewRecord(run){
  if(run.status==='skipped')return {events:[evt('skip','本次已跳过',run.reason,run.finishedAt)],result:null};
  if(run.status==='unknown')return {events:[evt('warn','等待原提交回执',run.reason,null)],result:null};
  if(!run.taskId||!run.turnId)return {events:[evt('error','任务未派发',run.reason,run.finishedAt)],result:null};
  const events=[launchEvent(run)];
  if(run.id==='seed-1'||run.id==='seed-5'){
    events.push(evt('read',run.id==='seed-1'?'读取项目研发记录':'读取学习笔记','已读取合成示例数据。',run.startedAt+1000),evt('work',run.id==='seed-1'?'汇总提交与待办':'归类并整理笔记','已整理要点。',run.startedAt+3000));
    if(run.id==='seed-1')events.push(evt('file','生成研发摘要.md','合成成果文件，不写入本机目录。',run.finishedAt-1000));
    events.push(evt('done','任务已完成','已保存本轮结果。',run.finishedAt));
    return {events,result:{kind:'final',...(run.id==='seed-1'?daily:monthly)}};
  }
  if(['seed-4','seed-running','seed-partial'].includes(run.id)){
    events.push(evt('read','读取示例需求记录','已完成初步读取。',run.startedAt+1000));
    events.push(evt('work','梳理待跟进事项','保留初步输出，等待进一步核对。',run.startedAt+3000));
    if(run.status==='waiting')events.push(evt('warn','等待用户处理',run.approval?.text??run.reason,run.startedAt+4000));
    if(run.status==='failed')events.push(evt('error','执行失败',run.reason,run.finishedAt));
    return {events,result:{kind:'partial',markdown:progress,artifacts:[]}};
  }
  return {events,result:null};
}

export function transitionPreviewRecord(previous,next,now=Date.now()){
  const record=previous.previewRecord??initialPreviewRecord(previous);
  let result=record.result;
  const events=[...record.events];
  if(next.status==='running')events.push(evt('start',previous.status==='unknown'?'已核对原回执':'已恢复执行',previous.status==='unknown'?'使用原任务及回合，未重新提交。':'本次回合继续执行。',now));
  else if(next.status==='waiting')events.push(evt('warn','等待用户处理',next.approval?.text,now));
  else if(next.status==='completed'){
    events.push(evt('done','任务已完成','已记录本轮结果（合成）。',next.finishedAt));
    result={kind:'final',summary:'本轮模拟执行已结束。',markdown:[...(result?.markdown??[]),'**本次运行已结束（原型合成）**','已演示任务结果的收取和展示。此模拟没有实际调用模型、读取仓库或生成真实文件。'],artifacts:result?.artifacts??[]};
  }else if(next.status==='failed')events.push(evt('error','执行失败',next.reason,next.finishedAt));
  else if(next.status==='stopped')events.push(evt('stop','运行已停止',next.reason,next.finishedAt));
  return {events,result};
}

export function runRecord(run){return run.previewRecord??initialPreviewRecord(run)}
export const confirmedTurn = run => Boolean(run.taskId&&run.turnId);
export function runResultSummary(run){
  if(run.status==='completed')return runRecord(run).result?.summary??'已完成，暂无可显示的结果';
  if(run.status==='running')return '正在执行本次任务';
  return run.reason||({waiting:'等待用户处理',claimed:'等待派发',unknown:'等待核对原回执',skipped:'未执行',stopped:'已停止',failed:'执行失败'}[run.status]??'');
}
// Keep the ledger's newest-created-first order, even when a late scheduled
// occurrence has a due time different from the latest manual trigger.
export function orderedPlanRuns(runs,planId){return runs.filter(r=>r.planId===planId);}
export const defaultRunTab = status => ['claimed','running','waiting'].includes(status)?'process':'result';
