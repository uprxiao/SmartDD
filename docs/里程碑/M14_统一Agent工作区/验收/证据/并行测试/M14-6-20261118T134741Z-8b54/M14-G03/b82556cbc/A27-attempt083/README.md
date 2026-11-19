# M14-A27 本地独立插件 083 原始尝试

- 候选 macOS arm64 `b82556cbc74646ec7ab2dfe9defc70a4e305ebac`，ASAR `898f908c7b2340262358d2adab2f1ade01eb14da46c796352bc668d7a59792fd`。使用本机隔离的 Claude 2.1.326、真实生产插件安装与审批界面，以及仅写私有文件的合成业务。未使用账号、邮件或外部服务。
- 原始驱动安装无连接插件，经真实 App 创建任务、提交真人消息、在原始回合中保留另一个真人排队输入、呈现原生工具审批。批准前的文件为空。真实点击批准后原业务执行一次，插件把本地效果文件及目录 fsync，保留结果未回复。含 `operationId` 的 [持久效果](attempt-083/effect.json)、[确认标记](attempt-083/effect-flushed.json) 和[尝试账](attempt-083/attempts.jsonl) 都留存。
- 故障守卫使用状态 `running` 筛选工具桥。冻结候选的生产实现把已核验、附加成功的工具桥登记为 `active`，实际的插件工作进程租约才使用 `running`。原驱动在该断言处停止，随后让原任务收口并正常退出。原 App PID 33959 退出 0，未启动新 App，未施加故障，不计本条崩溃恢复通过。
- [事后只读台账](attempt-083/reconciled-read-only.json) 将同一 run 的实际桥 PID 34159 及出生戳与 kernel peer 凭证相互核对。桥在 21:29:43.272Z 附加，21:29:43.335Z 有生产 kernel peer 凭证。插件工作进程 PID 34216 在 21:29:48.500Z 登记。桥在故障守卫失败后的正常收口阶段，于 21:29:49.800Z 退出。原 App、Claude、桥和插件工作进程四个 PID 都核实已经停止。业务终止状态来自此次正常收口。
- 新驱动按生产 `active` 枚举提取真实运行桥，同时核对出生身份及同一 run 的 kernel peer 回执。离线测试用 083 时间线和实际 kernel peer 数据复核判断，并验证错枚举、终止进程及伪回执不通过。仍需在新批次实际执行崩溃和重启。

[原始结果](attempt-083/result.json) · [审批截图](attempt-083/100-local-effect-waiting-approval.png) · [失败截图](attempt-083/99-failure.png) · [复验驱动](driver/README.md) · [证据 SHA-256](SHA256SUMS)
