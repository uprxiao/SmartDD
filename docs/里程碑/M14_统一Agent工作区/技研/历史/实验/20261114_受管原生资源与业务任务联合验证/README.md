# 受管原生资源接入业务任务：联合技术验证

2026-11-14；R01／02／08／10／11，Q01／03／09／48／51／52／53／54；技术方案 §12.1、验证账 §4.54。临时源码变体和独立 SQLite，不是产品开发或正式验收。

## 路径与结果

沿用 §4.47 的程序化 scope、来源修订、实际 CapabilityRunRegistry、配置修订、v1 ApplicationRunPlan、交付准备与门控启动候选。此前 managed ExecutionPlan 虽有类型，却没有把 native 根加入交付引用；基线实际拒绝 RUNTIME_NOT_PINNED，不能凭类型存在宣称已支持受管程序。

候选在同一事务写交付资源引用与 ExecutionPlan，将 adapter 和完整 native 包作为独立根。启动时先将准备资源交给实际 run 租约，核验全部成员后才释放准备占用。native 清单在事务外流式复核；进程内证明保留完整文件集合与 inode／大小／模式／时间身份，启动前和 gated 子进程附着后再短检查，避免在 C 锁／业务事务里反复整读数百 MiB。SDK JS 依赖仍是隔离环境固定包，未纳入新 native 包的资源闭包。

| 检查 | 证据 |
| --- | --- |
| M01 | 旧候选缺 native 交付引用，拒绝且事务回滚 |
| M02 | after-pins／after-plan 注入异常，交付、引用和执行计划共同回滚；正常重试固定原计划，换版本拒绝；准备完成时 native 仍由交付记录持有，尚未冒充 run 接管 |
| M03 | 受管 Codex 真实初始化，native 进入实际业务 run 租约；宿主调用实际 ToolService 的合成只读执行器成功；关闭项目应用后下一调用 APP_NOT_ENABLED，原 v1 计划不变；退出后释放 |
| M04 | after-arm 时将辅助 rg 换成相同字节但不同 inode，主程序未变；完整文件身份检查拒绝，spawnCount=0 |
| M05 | gated wrapper 已创建后替换 rg，附着后的检查拒绝，payloadReleased=false；只退出捕获的等待进程，run 排空 |
| M06 | Claude SDK 0.3.321 从受管 2.1.321 路径初始化，同一 run 保有业务上下文及 native 租约；结束后释放，无模型回合 |

最终 attempt-bIScVV 六项通过。最终三个捕获进程：Codex code 0；被阻止的等待 wrapper code 73；主动取消的 Claude code 143。后两者是预期停止，不写成正常完成模型任务。最终全部 run stopped、run 租约 released。两端原生包共 45 文件事后逐一重算摘要，未把受管目录缺失或恢复后的错误内容藏起来。

## 未完成尝试

attempt-Da3SWa：M01–M02 通过，M03 已返回真实 status=ok，驱动却检查 response.ok，因字段错误失败。修正驱动，不修改 ToolService。

attempt-rSCv8p：M01–M03 通过，M04 故障注入误写 bin/rg，实际包路径是 codex-path/rg，ENOENT 不能算晚变更防护通过。改为从固定清单找辅助程序后重跑。每次新运行准备重新流式建立文件身份，避免把故障恢复造成的 ctime 变化当成旧证明仍有效。三次尝试共五个捕获退出回执，原失败与数据库都保留。

## 对设计的意义及边界

原生生命周期 guard 与完整业务 run 不是同一种授权。本批已将 native 接到原程序化业务候选，不要求撤掉 R17、Skill／MCP 的业务桥合同。任务、能力来源、配置修订、应用计划、运行资源与实际子进程仍分别绑定；更换 provider 不能靠重用另一个 run 的私有句柄完成。

run 本身先预留，随后交付引用与 ExecutionPlan 原子生成。正式启动入口必须统一要求完整执行计划和资源接管，不能存在只看到 run=prepared 就直接 fork 的旁路。前置异步校验尚未持有安装／准备租约时，清理竞争可导致准备失败，不能从本批推导该窗口已有无中断可用性保证。

准备→run 交棒已测，但执行计划的长期历史保留、跨宿主重新建立文件证明、默认版本变化与任务接受时的绑定政策、真实 GC 的删除／恢复仍待联合。门控放行后到内核 exec 之间不声称 OS 级文件封存；本机 metadata 校验不能等同全平台防替换保证。

M03 是宿主使用已认证 run 调用实际 ToolService，执行器为合成只读返回；不是模型通过私有 MCP 发起浏览器、邮件或插件操作。没有真实账号、外部业务写入或模型费用；完整原业务回归和 SDK-origin MCP 链继续独立核验，不以本批替代。

T3 的安装／启动资源分层仍是参考，WillYou 需保留自身业务权限与持久资源关系。本批不修改 T3，也不将其机制直接当作 WillYou 已集成。

## 证据

[结果](result.json)、[运行与失败审计](runtime-audit.json)、[源码基线](source-review.json)、[证据摘要](archive-manifest.json)、[驱动、源码变体及数据库](raw-evidence.tar.gz)。234 归档文件、16 份 SQLite 完整性／外键通过、504 个唯一构建输入复核。大 native 二进制不重复入库。

复跑需在新临时目录恢复依赖、路径和进程身份 helper，先 build.mjs 与 profile-build.mjs，再 probe.mjs。配置使用合成值和隔离 HOME；故障只改本轮受管副本，取消只操作自己捕获的进程。不能将研究候选当作产品安装器运行。
