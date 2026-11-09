# P069003 中途 CPU 的纯文件诊断

依据冻结 source017 与已经保存的采样，未连接 App inspector，未启动 Native、OS 探针、构建或监听，未改变正在执行的场景、采样或阈值。这不是 T111 最终判定，也不是已证实的根因。

1. **现有高数值不是明显的单位或重复统计错误。** `snapshot.json` 固定了原 request115/116（22:27:25→22:27:30 UTC）。Python monotonic 间隔4.894067375s、wall4.894074s、driver monotonic4.894083542s；主进程45409累计user+system增加2.972012544s，单独重算为60.72684%单核，总计60.95275%。两次均无重复PID，无新增/缺失身份。`resource-sampler.py:14–27` 以PID集合合并seed/包路径/后代来源，每PID仅发一行；`:31–36` 使用本进程CPU累计秒与RSS，未把 Electron metrics 再加一次。`analyze.py:37–49` 对同identity作差，再除采样自己的monotonic间隔；CPU不除16核心符合当前明确onecore口径。Python与Node时钟的绝对原点不同，但这里未跨时钟作CPU时间差，重算的三种间隔一致。

2. **没有发现 F-SITE 页面或受管caller忙循环。** `run.mjs:27–28` 页面只有静态HTML与一次randomUUID，没有timer/animation/polling。已保存live仅五次初始/page/1…5请求。`receiver.py:19` 阻塞stdin，`:28–35` 仅收到每5分钟指令后启动原CLI并communicate等待，未采用五个inbox轮询。driver `run.mjs:56` 在外部进程每5秒采样，其余≤1s timer等待；`:33–35` 每次会只读调用一次真实App metrics，因此观测并非零开销，但未见每40ms持续询问App的idle循环。外部采样器不属于App CPU累计。

3. **存在一个明确、值得测后优先定位的生产调用链。** `src/main/core/applications/task-capability-launcher.ts:77` 把完整`sessionDiagnostics.inspect(taskId,runId)`注册为SkillObservationMonitor回调；`:366` 在实际spawn后启动。`skill-observation-monitor.ts:5,15–17` 默认每2秒持续收集。当前五活跃caller即使没有真实model日志，也会触发五套监测。`session-diagnostics.ts:183,200` 每次inspect先后调用两次inspectBase；`:249,267` 每个base分别进行整体及app级resourceIssue；`:134` 对application-package做verifyPackageTree，对runtime做RuntimeRegistry.verify，并验证投影。`package-files.ts:20–25,40–48` 每次重新枚举全树、读文件、SHA；`runtime-registry.ts:55–65` 也重新枚举并读哈希全部runtime文件。该路径与主进程持续消耗在位置和触发条件上一致，但没有profile/调用计数，不能据此认定其贡献为60%或直接改实现。

4. **其他静态线索与边界。** 主进程还有`task-service.ts:707–739`每任务1500ms查尚未出现的原生会话；`task-capability-launcher.ts:129,487–488`每500ms扫active run（该处仅查run状态）；`AgentBridgeProcesses`500ms仅遍历已有tracked桥。`agent-browser.ts:101`100ms daemon观察器仅在单条command pending时存在，`:95`响应后清除，不能仅凭该行认为五页idle一直50Hz观察。文件监听实现有事件/补扫，但本组driver没有启动文件watch的直接调用，现有保存资料未记录watch资源数，不能断言无watch或已有反馈环。`park-window.ts`没有显式JS轮询；真实透明shown+backgroundThrottling=false属于当前被测生产停放行为，不能为降低结果而改成hide/throttle。

**测量结束后的最小下一步：**保留本轮完整30分钟原结果和原阈值，再在独立诊断租约中对同五页场景采主进程CPU调用栈/或精确被动调用次数，先核SkillObservationMonitor→inspectBase→resourceIssue→verifyPackageTree/runtime.verify；同时区分尚未绑定session的真实任务轮询成本。若需要消融，单独标明为诊断夹具，不能改变本轮或当正式T111通过证据。当前仅能确认主进程高CPU实际存在于已存区间，不能宣称根因已定位或T111最终失败/通过。

全部引用文件SHA和两原始样本载体见`snapshot.json`。源码均为source017；活动证据只读后另存到本私有诊断根，未改P069执行目录。
