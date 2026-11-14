# 原生私有 MCP、插件审批与共享进程归属

2026-11-14；R02／03／08／10／12，Q09／27／28／40／41。技术方案 §9.5，验证账 §4.65。仅隔离技术研究，产品／共享原型未改。

## 本批实际链路

`Codex／Claude native → stdio MCP → 现有私有 broker／内核 peer → ApplicationToolService → PluginSessionTools → PluginWriteApprovals／实时策略 → PluginLifecycle／沙箱 PluginProcess`

沿用当前程序化 run／binding／执行计划；安装受控 demo-tracker 测试包，由实际包校验和 PluginHostService 接管。插件代码只向自己的临时 privateData 追加合成 calls.log，无网络／真实业务连接，无 Keychain 读取。审批通过之前的“真实 handler”是现有 PluginSessionTools／生命周期／沙箱分发；插件业务代码本身是夹具，不声称验证真实业务插件内容。

## 最终 attempt-0bcfLk：3 项通过

| 检查 | 证据 |
| --- | --- |
| B01 Codex | 模型驱动真实原生 MCP 写工具调用，实际业务审批阻止派发；错误窗口无权批准，当前隔离窗口回执允许后沙箱插件执行一次。结果进入下一模型请求；运行中停用后第二调用返回 APP_NOT_ENABLED，无第二次写入 |
| B02 Claude／Provider 切换 | 同一逻辑 task 从已排空 Codex 切 Claude，真实 SDK 私有 MCP 走相同审批与写处理器；旧 run 工具／桥入口拒绝，新 run 批准不恢复旧权；两次批准分别属于原 run 和 operationId |
| B03 共享插件进程 | 两个 Agent run 已 stopped、自己的 bridge 已退出时，宿主的同一个插件 invocation 进程仍 running；原 PID／出生身份实际仍存活。明确关闭本次 PluginHostService 后，该进程 stopped、插件租约 closed，其他运行租约 released |

两条 application_invocations 均 write／succeeded／completed／attempt_count=1，和两条 allowed 审批及插件收到的 operationId／runId 一一对应。六次本机模拟模型请求；原生 Codex 回合 completed、Claude success，进程分别受控退出 0／143。每个 Provider 的停用后调用均回到下一模型输入，未执行插件第二次写入。审批窗口是研究 WeakMap 句柄，不是真实 renderer／IPC／真人批准界面。

## 保留的失败与设计修正

初次 attempt-syS9QW 的 B01、B02 已通过；B03 错误要求所有插件租约随 Agent 结束关闭，实际剩一条宿主 invocation 租约 running。源码 PluginRuntimeSupervisor.current 按 appId 复用进程，引用数归零且未 retired／未到回收条件时保留；该进程服务了两个 Provider 的调用，不是原生 Agent 的后代。

因此修正的是实验与设计假设，未改生产实现。最终检查先证实宿主池合法保留，再执行自己的 PluginHostService.close，核验真实退出。初次失败数据库保留 running 行，finally 也已关闭本次宿主；两个批次最终均无遗留运行。两批共四个 native、四个插件进程（各一次 activation／一次复用 invocation），均有最终关闭记录。

## 迁移规则

Agent 生命周期、调用生命周期、宿主插件服务生命周期分开。切 Provider／取消单 run 只撤销该 run 的私有入口和未完成授权，等待属于它的调用结束；不能因同一宿主池进程还活着把任务永远卡在 stopping，也不能直接杀共享插件进程影响其他运行。插件更新／卸载／宿主关闭继续走现有 drain、references、retired 和独立 plugin_runtime_leases，包与私有数据不能因 Agent 租约释放就清理。

共享进程不等于永久业务授权：每次调用仍重新校验原 run、当前安装版本、项目启用、具体审批回执和 operationId。本批同一进程复用时，各 run 的权限与回执仍隔离。是否持有工作目录写权另判；活动／未知的任务调用或有未排空写者时，SVN 目录租约仍阻止交棒。此受控插件仅能写临时私有目录，不证明所有插件后台与项目写入都可安全放行。

未覆盖真实 UI 审批、并发多个 Agent 同时调用、插件更新／卸载竞争、含连接／秘密的插件、真实业务插件内容、父子树、崩溃恢复或跨平台。现有插件沙箱路径由实际代码执行，本批不声称完成沙箱逃逸测试。

## 证据

[结果](result.json)、[原失败／最终池归属审计](runtime-audit.json)、[源码依据](source-review.json)、[摘要](archive-manifest.json)、[驱动／插件源码／协议／数据库](raw-evidence.tar.gz)。217 个文件、8 份 SQLite 完整性／外键通过，853 个构建输入复核。

复跑需固定 SDK/native 和依赖；执行 build.mjs 后 probe.mjs。仅临时 HOME、受控测试包、本机模型端点和捕获的自有进程，不连接真实业务。
