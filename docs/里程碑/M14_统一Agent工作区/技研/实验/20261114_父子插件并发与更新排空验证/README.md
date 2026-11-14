# 父子 Agent 插件并发与更新排空

2026-11-14；技术方案 §9.6，验证账 §4.66；R02／05／06／08／10，Q09／27／28／40／41。仅隔离技术验证，产品与共享原型未改。

Codex 0.167.1 父运行通过候选委派创建 Claude Agent SDK 0.3.321／native 2.1.321 子运行。两端真实 stdio MCP 经现有私有 broker、内核 peer、ToolService、PluginSessionTools、写审批和沙箱 PluginProcess。子任务使用独立目录，不声称验证共享 SVN 写入。模型端点为本机受控响应；插件只写临时 privateData，无真实连接／秘密。

## 实际结果：attempt-YFbdYm，P01–P04 通过

| 检查 | 观察与断言 |
| --- | --- |
| P01 两项在途审批 | 父子同时通过原生工具发起写调用，两条审批分别绑定 task／binding／run；交换审批会返回 DECISION_RUN_CHANGED，允许之前零写入 |
| P02 更新等待两个调用 | 旧版本两项调用已预留后开始安装 0.1.1；直接观察实际 drain 进入，preparing 已落库，安装版本仍旧。先允许子调用并停止子运行，父审批仍在且更新未完成；再允许父调用，两次旧版本写入完成后更新提交，数据保留 |
| P03 同一父会话用新版本 | 同一个原生 Codex thread 再发一轮，使用当前兼容插件 0.1.1；产生新包哈希审批，旧回执 AUTHORIZATION_REQUIRED。第三次调用账记录新包；启动计划与旧选择快照不被改写；下一模型输入带 VERSION_0.1.1:PARENT_NEW |
| P04 按各自所有权释放 | 两端原生／私有桥退出，run 租约 released；关闭本次 PluginHostService 后剩余插件 lease closed，记录的当前 PID／出生身份确认 stopped；秘密读取计数为零 |

三条实际业务调用均 succeeded／completed／attempt_count=1，与三条 allowed 审批及插件收到的 operationId 一一对应。插件写入顺序 CHILD_OLD、PARENT_OLD、PARENT_NEW；六次本机模型请求。两个真实原生进程受控退出，Codex 0、Claude 143。原生请求日志证实只创建一个父 thread，两个 turn/start 使用相同 threadId。

## 设计结论

现有 PluginLifecycle.withInvocation 的引用覆盖“审批等待至处理结束”，不只覆盖子进程实际执行时段。更新把旧 RuntimeEntry 标记 retired，等待引用归零，再关闭旧进程、迁移数据并激活新版；不能通过结束一个子任务清除其他任务的预留。跨 Agent 并发使用同一插件仍需逐次验证身份与业务审批。

启动快照是来源审计，当前安装与策略决定实际调用。兼容更新可在同一 run／native thread 使用，但新调用账与审批绑定实际新包，不能把旧 packageHash 改成新值来伪造启动来源，也不能沿用旧审批。兼容性仍由既有 capability／permission／semantics／slots 检查决定；本批只验证兼容补丁更新。

T3 的活动 providerSessionId／responseCapability 守卫是运行请求归属参考；本批插件更新排空和包审阅行为来自 SmartDD 现有服务，应保留而不是替换成 T3 不相关的实现。

## 证据边界

审批窗口为研究私有句柄 facade，未走正式 renderer／IPC；规则由受控模型调用触发，不验证模型自主规划。drain 只加入口／返回观测，仍执行原方法；候选委派／启动接线在临时目录。审批是同时等待，两个沙箱写按测试顺序执行，不声称同时执行两个有副作用的插件函数。

未覆盖卸载、拒绝／过期与更新的组合、不兼容更新、更新中宿主崩溃、真正业务连接／后台写、共享 SVN 目录、真实 UI 或跨平台。旧版本安装收尾可能删除其已关闭 lease 行，因此最终 plugin-leases.json 不是全部历史进程清单；保留中间 SQLite，不用最终行数倒推总进程数。当前证据不代替完整产品验收。

[结果](result.json)、[运行审计](runtime-audit.json)、[源码核对](source-review.json)、[摘要](archive-manifest.json)、[原始脚本／协议／SQLite](raw-evidence.tar.gz)。归档 142 文件，5 份 SQLite 完整性／外键通过，853 构建输入哈希复核。

复跑固定当前 SDK/native 与依赖，按 build.mjs／build-bridge.mjs 和 probe.mjs 的临时路径配置；不读取日常配置或连接真实模型／业务。
