# 共享目录串行准入与启动身份验证

日期：2026-11-14。关联 R06／R09、Q31–33。独立技术验证，不是产品实现或验收。

## 执行范围

将原候选路径门槛扩为两个实际宿主子进程争抢同一 SQLite 租约；实际 CapabilityRunRegistry 管理合成任务、原生进程身份、withActivity 和资源释放。Agent 替身是本轮捕获 PID 的受控 Node 写者，不使用真实 SDK 或模型。新建本机 SVN 仓库／工作副本和符号链接，无用户数据。

候选首版不开放并行只读；requestedAccess、提示词、nativeSandbox、readOnlyHint 仅作为请求／审计信息，实际都按可能写入者取得租约。没有声称已实现经过认证的并行只读分支。

| 检查 | 结果 |
| --- | --- |
| A01 两个不同项目标签通过 SVN 根下不同子目录／别名申请只读 | 两者排队，未启动后继 Agent；根内兄弟目录同样冲突 |
| A02 原生已退出但实际 withActivity 仍在途 | run 仍 stopping，租约不能释放，两请求继续排队 |
| A03 实际 run 已 stopped，但执行范围证据未知 | 租约仍保留；不能仅凭 stopped 交棒 |
| A04 排空后两个宿主进程同时争抢 | 一方持有、一方排队；仅赢家启动受控写者，退出后才释放 |
| A05 同一路径下 SVN 子目录被替换 | 原候选漏检；补 cwd 物理身份后拒绝，恢复原物理目录后可复核 |
| A06 排队者获准后，输入路径被符号链接改向 | fork 前复核拒绝，未启动 Agent |

最终 6 项通过，四个本轮进程 exit 0，三份租约均释放。只有父与赢家两个受控 Agent 写者实际启动。其余两个进程负责候选调度争抢，不是业务 Agent。

## 保留的失败与修正

初次五项检查记录为 attempt-hC7xOy。随后增加“同路径子目录替换”回归，attempt-lxbH2l 在 A05 确定失败：仅比较 WC 根 dev／ino 与 cwd 字符串不能发现子目录物理替换。before-fix-gate.mjs／before-fix-probe.mjs 保存该失败输入。只在临时 gate 增加 cwdDevice／cwdInode，attempt-wBqnbl 全部六项通过。

初次五项运行未单独冻结那一版完整驱动，记录保留为探索上下文；修正结论依据有源码快照的六项失败／复验，不把初次记录补造为完整可复现基线。产品源码未改。

## 仍未证明

Gate 是候选，并未接产品；租约数据库与实际 owner 数据库分开，不证明二者跨库提交原子性、宿主 SIGKILL 恢复或长期公平性。本批没有跨进程恢复，不覆盖全部等待取消分支。受控脚本没有后台后代；scopeKnown 的真值只用于该脚本，不能作为任意 SDK／shell／MCP 后代已排空的证明。

物理身份复核证明能发现检查时已发生的变化，不消除最后检查与 fork 之间的路径竞争；不能宣称路径被 OS 原子锁定。多平台、完整 launcher、动态来源／权限变更以及真正只读准入仍待验证。六项通过不替代之前原生委派／业务链实验，也不把它们自动合并成端到端通过。

## 复现与证据

在已记录依赖存在的本机运行 `node probe.mjs`。依赖前轮 viewer-lifetime 实际服务 bundle、owner-probe SQLite／进程身份工具及本机 svn；input-build.json 核对执行前源码与产物摘要。原始脚本固定临时依赖绝对路径，不是独立发行包。回归前版本使用 before-fix 两文件，恢复为对应文件名后运行即可观察 A05 失败。

[结果](result.json) · [源码基线](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
