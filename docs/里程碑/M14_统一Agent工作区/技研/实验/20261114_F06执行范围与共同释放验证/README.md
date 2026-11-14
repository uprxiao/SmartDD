# F06 执行范围、实际运行资源与目录共同释放

2026-11-14。**阶段性证据，F06 尚未关闭。** 本批补齐固定的四类拒绝断言和正常交棒，另实测宿主死亡后普通活动被恢复逻辑清除的风险。真实 Driver 的成员收集终结依据、首批平台覆盖声明仍需收口。

## 已执行

| 检查 | 结果与证据边界 |
| --- | --- |
| S01 负对照 | 当前实际 finisher 在只登记 root 时可释放 run／资源，另一个本次宿主创建的后台工作仍写入合成文件；验证的是缺口，不能当安全释放通过 |
| S02 已知后台未结束 | 当前实际 run registry 加独立持久 scope／共享 finisher guard：root 退出，后台仍可写，run 保持 stopping、资源租约和目录权保持，下一写者 queued |
| S03 closing 迟到 | 旧回应修订和复制 scope 句柄拒绝；closing 后的清理成员观察不丢弃，scope 变 unknown、修订增加，占用保持 |
| S04 unknown | 所有已知 PID 已退出，范围覆盖仍 unknown；不能仅凭已知集合为空释放两类占用 |
| S05 正向交棒 | 夹具证明其完整创建集合全部退出后，在同一 SQLite 事务标 scope drained、调用实际 finisher、释放目录权；下一写者真实启动并写入，随后正常退出 |
| S06 目录身份 | cwd 或范围根在准备后同路径替换，设备／inode 复核拒绝启动，未 fork 之前仍保留占用；恢复原目录、显式无 fork 取消后释放 |
| R01 恢复负对照 | 确认真实测试宿主 SIGKILL、原生根已退出；当前恢复器将普通 activity 改 owner-stopped，忽略额外 unknown scope 而释放 run／资源 |
| R02 恢复共同检查 | 同份隔离数据副本／实际恢复器仅增加共享 finisher guard，普通 activity 同样结束，但 run 为 orphaned、资源为 recovery-required，unknown scope 保留 |

S01–06 在 attempt-3mB9fF 通过；R01–02 在 recovery-9xRDJN 通过。八项包括两个负对照，不能相加为八个产品功能。主批五个宿主直接创建的 Node 工作进程逐一记录 PID／出生身份并确认 stopped；恢复批另一个实际宿主和其工作进程已确认退出。没有启动模型、真实业务写、第三方 daemon 或 SDK。

后台工作是宿主直接创建并登记的夹具进程，不是 native 派生进程收集器；目录中的 .svn 是范围识别标记，不是新建真实 SVN 仓库。真实 SVN 目录、别名／双进程争抢及普通 SDK 后台停止分别复用 §4.7／10–11／28／84，不能把本批升格为公司大项目／任意后代的验证。

## 发现和设计决定

scope 不能仅用普通 withActivity 表示。当前 recoverCapabilityRuns 会在 owner 死亡后结束其 activity；共享 finishCapabilityRun 必须独立检查 scope 的覆盖状态与修订。只让目录 Gate 等待不够，资源租约也可能已经被释放。候选 scope／member／workspace hold 与现有运行表放在同库，正向提交有一致终结点。

候选正常／恢复路径共用一个源自当前 run-recovery.ts 的 guard；其余运行注册器／资源库／内核身份保持源码原样。guard 要求 scope 存在、known、drained 且 drained_revision 等于 revision。root exit、空集合或普通活动结束都不能替代该依据。主体 schema 是隔离扩展，尚未纳入 C1.2 正式迁移，不宣布新的 C1.3 基线已完成。

首次 attempt-BHINaD 的 S01 通过、S02 失败：actual assertOwnedCapabilityRun 同时要求运行已准备到可签发桥阶段，不能在 preparing 时调用。测试改为 prepare 后、任何进程启动前登记 scope 再复验；没有放宽现有所有权检查。正式实现应在宿主 reserve 的同一事务写 required 标记与初始 scope，不能照搬本探针的两步安装窗口。构建阶段也曾未展开 assets 的 Vite glob，修正后又遇目录 glob 被当文件读取；最终显式过滤文件并展开，379 项当前源码输入摘要复核。构建失败不计运行检查。

## 不能由这些结果推出的结论

reconcileCaptured 是夹具内部操作：创建哪些进程已由测试自身完整掌握。产品不得给 renderer／模型／普通 UI 一个 scopeKnown=true 的入口，也不得因为所有“已看见”进程消失就调用它。当前候选没有实现真实进程枚举器的封口、待处理观察排空或不可逃逸 OS 容器；未证的范围保持未知。

T3 当前 ClaudeAdapterV2 在无 AgentScope 时，运行中读取进程表并记录后代，退出后核对出生身份清理。AgentScope.ts 描述 systemd scope 的支持路径；这不意味着 macOS 有同等不可逃逸边界。此前真实逃逸反例仍成立，不能用本批已知成员集合覆盖它。下一步限定为首批 native／平台的实际可观察范围、收集器封口依据及正常自动交棒准入，不扩建通用沙箱，也不重新跑全部 Agent 配对。

路径检查也不是 OS 目录锁。本批证明准备后的路径替换会被检查发现；真正进入 OS cwd 的窗口仍需接既有启动门闩，且当前运行可写范围、SDK 附加目录、MCP／业务写入与 F08 的独立活动一起裁定。未知范围时保留权利不等于核心流程已可用；需用已声明正常范围证明真实 native 能自动交棒之后再关闭 F06。

## 证据

[主结果](result.json)、[恢复结果](recovery-result.json)、[scope 与目录记录](scope-state.json)、[退出记录](cleanup.json)、[源码与单处变体](source-review.json)、[原始 SQLite／脚本／失败归档](evidence.tar.gz)、[摘要](archive-manifest.json)。无用户凭据或日常数据库。复跑依赖 macOS arm64、记录的 Node／better-sqlite3 和 process-identity helper，执行 build.mjs 后分别运行 probe.mjs／recovery.mjs；脚本保留原依赖路径，迁移环境需恢复并核对摘要。

恢复实验的最终隔离库有意保留 unknown／recovery-required，不人为把它改成已结清。所有被捕获进程已结束，不存在等候的后台测试任务。研究状态和产品验收数本批均不提升。
