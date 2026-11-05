# T111 短子进程 CPU 统计边界与补充方案（只读静态稿）

本稿不运行原生程序、OS 采样、编译器或 helper；不改变 003 的 raw、analyze、曲线、通过阈值或生产 App。依据与逐字段源码快照见 review.json 及 sources/。

## 已确认的边界

原 sampler 以约 5 秒枚举一次进程，累计当时记录到的每个 PID/birth 的 user+system；完全落在两次枚举之间的进程可能从未进入 known。已安装 psutil 7 的 macOS 实现将 children_user、children_system 明确固定为 0，原 sampler 也没有读取这些字段。因而相邻“已观测身份集”相等不能证明全部实际短进程都被统计。

017 的后台观察链确实可以每约 2 秒进入完整 inspect，再经 currentNativeRun → MacProcessIdentityReader.read → execFileSync 启动包内 identity helper。020 的负向提示门闩减少了无变化场景的完整 inspect，但没有把所有真实生产身份核验改成不产生短进程。源码证据只能证明存在实际可达的 spawn 路径，不据此反推 003 每次短进程的出现次数或 CPU。

003 已测 own CPU 为 58.98563893755239%（100%=一个逻辑核），单此贡献已明确超过 5%。漏掉的非负子进程 CPU 不会令本次失败变成通过。原主进程份额只占“已测 own CPU”，不能写成完整生命周期总 CPU 的份额。RSS 是原采样时点 RSS 的判据，不因本次 CPU 边界核查擅自追加历史瞬时 RSS 峰值合同。

未来若观测 own CPU <5%，仍需独立证明全 owned 生命周期 CPU 范围完整，才能判原完整 CPU 项通过。原 S03/S05 输出保持；本稿将其支持范围限定为已观测集合/采样时点 seed 包含性，不替它们补造不存在的短进程证据。

## 本机 Darwin SDK 可用契约

MacOSX26.5 SDK libproc.h 提供 proc_pid_rusage(pid, flavor, buffer)，说明目标可以是 live 或 zombie。sys/resource.h 的 v1、v2 结构均包含 ri_user_time、ri_system_time、ri_child_user_time、ri_child_system_time 以及 start/exit abstime。15.4 SDK 同样存在 child 字段。这里没有通过头文件名称推断 child 的精确计入时机、计量单位、递归包含、重父化与原子性；这些是待实测门槛。

getrusage(RUSAGE_CHILDREN) 的文档对象是“调用进程的已终止子进程”。在外部 Python sampler 中调用它，得到的是 sampler 自身的子进程，不是目标 App。wait4 的本机文档说明返回终止 child 及其 children 的资源汇总，可在受控验证程序中使用；不得为测量 App 而另行 wait/reap Node 管理的子进程。

## 补充采集候选：外部长期采集器直接读取 libproc

保留原 5 秒采样周期、原 OS own CPU/RSS raw、原 0/5/10/15/20/25/30 分钟数据、35 正式+5 warm、原命令活动窗口和全部 idle 峰值。外部长期采集器通过 FFI/原生绑定直接读取目标 PID 的 proc_pid_rusage，不为每个样本新 spawn 一个查询 helper。写独立追加流，不覆盖旧载体。

候选原始字段：采集开始/结束单调时间、PID/birth、parent PID/birth、owned 依据及所属 forest root、flavor、API 原始返回/errno、self user/system、child user/system、start/exit abstime、原始整数及经门槛验证的单位换算、枚举前后变更/不确定性。身份和所有权继续按私有 App/Helper 路径、真实进程出生身份和原执行组归属核对，不读日常进程参数或环境。

该方案只有在受控验证证明语义之后才可用于验收。若接口权限或重父化不能覆盖全部 owned CPU，补充项应返回 coverage-incomplete，而不是把漏项当零。提高枚举频率只能降低漏采概率，不能证明全部短生命周期已覆盖。

## 避免活进程与回收累计双算

禁止直接把“原 live PID 差分”与“父进程 child 累计差分”相加。一个子进程在前一时点已贡献的 CPU，可能在后一时点整体转移到父的 child counter，直接相加会重复计数。

待验证的候选累计量是整个已确认 owned 森林的 live frontier：

    F(t) = sum over live owned p [selfCPU_p(t) + reapedSubtreeCPU_p(t)]
    intervalCPU = F(t2) - F(t1)

这不是已证明的 Darwin 契约：只有当 child 字段确实仅计入已从 live frontier 移除的、无重复的递归子树，且所有权/重父化/采集竞态都闭合时该式才成立。也可以实现等价的 birth/exit/rollup 转移 ledger，逐一扣除之前已归属的累计量。两种方式必须对同一受控 trace 给出一致结果后再选用。

举例：t1 的活 child 已用 100ms，t2 终止并归并 150ms；正确该区间为 50ms。若在 parent 新增 150ms 之外再加 child 的 50ms 会错误得到 200ms。一个完全在两次采样之间完成的 40ms child 应通过 parent 的真实回收累计补入 40ms。孙进程先归并到 live child、child 再归并到 parent 时，累计信用只能移动一次，不得再次创造 CPU。

读数并非原子快照。至少在读取 live frontier 前后重读父 child counters/身份集合，保存读区间；变化时有限重读或标记 uncertain。累计量下降必须诊断转移/重父化/身份问题，不能 clamp 成 0 取得通过。时点误差与单位量化的容差只能用于受控验证解释，不上调 5% 阈值。

## daemon / reparent 与区间边界

agent-browser daemon 可能脱离原 parent，但仍须按本轮私有 pid/birth/可执行身份作为独立 owned root 统计。若它退出后由非 owned parent 回收，App 的 child counter 未必收到最后一段 CPU；5 秒轮询即使能读取 zombie 也不能保证赶上已 reap 的进程。必须有验证过的终止累计来源/可信生命周期 ledger，或者明确报告 coverage gap。退出 callback 的壁钟时长不能充 CPU；不能偷取 Node wait4 或改其退出行为。

保留原命令 start/end 活动区间，不把高 CPU 样本改标 active 来消绿。对于跨区间生命周期，完整 F(t) 能正确抵消此前活进程贡献的前提也必须验证。若只在 wait 时才看到全部历史且没有可闭合的区间归属，应保留不确定性，不能任意塞入/排除 idle。

## 应用于未来 T111 的门槛

先通过 controlled-validation-plan.md 的受控原生门槛，再静态接线 sampler 补充流和独立 full-scope adjudication；通过纯数据 trace 单测验证无双算/不丢失/拒绝未知语义。之后才考虑新 App019 的原完整 1800 秒实测。原 003 红与曲线不变，未来 CPU 判定仍为原 5% one-core 规则；任何缺口不自动通过。
