# 宿主子任务提问与旧回应隔离验证

日期：2026-11-14。关联 D06、Q26，兼及 Q11／27／28。真实 Claude SDK 0.3.321／native 2.1.321、HTTP MCP、当前实际会话／运行注册器及同一 SQLite；父子关系、父 binding 指针和回应账为独立候选。

| 检查 | 结果与范围 |
| --- | --- |
| J01 同文并发 | 两个独立子任务同时出现相同 message／schema；跨子任务和父 task 作用域的回答均拒绝，未发送 |
| J02 父指针变化 | 候选父 binding 改变不改变子问题 owner，子问题仍等待回答；没有执行真实父 Provider 切换 |
| J03 取消隔离 | 停止 A 后旧回答拒绝，B 的 B_ONLY 回答由实际 MCP 收到；重复决定没有额外发送 |
| J04 同会话新运行 | A 通过实际 SDK resume 沿用 native session ID，新 run／generation 拒绝旧回答；实际 MCP 收到 A_NEXT |

最终四项通过，五个本机合成模型请求、三个原生进程均退出；主动中断的 A1 退出 1，正常 B1／A2 退出 0。实际运行均 stopped、租约 released，SQLite 外键及完整性检查通过。首轮 localhost 监听被沙箱拒绝，未启动原生进程；授权本机执行后通过，失败记录保留。

归属按 task／binding／run／generation／connection 和实际原生 requestId 绑定私有句柄，发送前复核实际运行所有权及当前子 run。子任务拥有独立原生会话，区别于同一 Provider 内部子 Agent 缺少提问子身份的问题。父只是候选关系记录，本轮没有实际父原生运行，也没有完整 delegate 创建／outbox 服务。

## 发现及后续

驱动 stop() 对正常完成的 B／A2 也调用 ledger.cancel，终态为 expired、cancel_requested=1，close_evidence 为空；两份答案投递记录为 submitted。这不否定回答确实抵达 MCP，但不能证明正常请求关闭、UI 终态或真实取消意图正确。正常运行退役必须与取消分开，原生关闭与消费证据须精确关联；不得补造 Claude resolved 通知，也不按同文表单猜归属。下一步补同一问题账的正常关闭／取消差异及恢复证据。

本轮回答和模型都是合成内容，不是真实用户审批；没有外部供应商付费调用。真实 UI／IPC、业务审批、Codex 混合子任务、父原生 Provider 切换及问题账崩溃联合仍未验证。Q26 只推进为部分证据，不代表多 Agent 产品闭环。

## 复现与证据

固定依赖及本机监听权限具备时，依次执行 `node build.mjs`、`node probe.mjs`。归档包含驱动、实际构建、来源摘要、两次 attempt、原生帧、MCP 结果和数据库；使用隔离 HOME／配置及合成凭据，不读取日常账号配置。

[结果](result.json) · [来源](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
