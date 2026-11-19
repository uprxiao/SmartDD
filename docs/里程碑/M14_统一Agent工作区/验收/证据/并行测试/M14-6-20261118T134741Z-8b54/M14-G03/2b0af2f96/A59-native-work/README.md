# A59 原生工具折叠和子事件隔离

macOS 26.6.1 arm64，feature/0.1.6，隔离签名包 `2b0af2f9604db03d8e8062e72517f4a9fb68b92e`。实际本机 Codex 0.169.0、Claude 2.1.326，回环使用合成模型响应，不读取日常 App 配置。真实 CLI 执行，App 的 UI 操作走后台 CDP。 [构建与哈希](../../../build/candidate-2b0af2f96/package-2b0af2f96-sha256.txt)

- 199 的两个只读命令都实际结束。驱动在完成内容显示前点击原本已展开的工作组，把它关上后等待内部列表，导致夹具失败。原回合记录用当前正式投影核过，且补充验证等待到当前轮终态才操作折叠。 [199 保留记录](attempt-199/result.json) · [旧输入预检](work-fold-199-preflight.tap)
- 202 独立核实同一原生回合内两项不同命令，均退出 0，同时重叠 1,971ms。页面显示「已工作 2 秒」「运行了 2 条命令」，实点展开该项得到两条原命令，App 和原生进程均关净。 [实包记录](attempt-202/result.json) · [SQLite／截图独立核验](verified-202.json) · [折叠](attempt-202/01-both-completed-native-commands-grouped.png) · [展开](attempt-202/02-same-work-group-two-nested-native-commands.png)
- 200 原生子进程真实读取合成文件，旧夹具把异步 Agent 启动收据当成子任务终态，未完成父级验证。203 又把较早的宿主上下文注入确认当成同轮父终态。两次 App 均正常退出。 [200 保留记录](attempt-200/result.json) · [200 独立核验](verified-200.json) · [203 保留记录](attempt-203/result.json)
- 204 在同一原生运行和节点，把 Claude 子内部的 Read、结果与终态逐项关联到真实 wire UUID、原生 side-chain 和 SQLite。子终态进入同一节点时，父仍保留原 native turn，实际 UI 显示父自身持续输出。真实点击抽屉能读到子结果，主时间线不混入子标记。父回合之后用同一 native turn 独立结束，最终正文只出现一次。实际运行未公布带 parent ID 的子流片段，已发布的子工具结果与消息均核对。App 和原生进程全部退出。 [实包结果](attempt-204/result.json) · [独立核验](verified-204.json) · [原失败输入和回执窗口预检](preflight.tap)
- 独立重查实际迟到帧旧包 192 与新包 196 的源字节及不同原生回合，确认新包无再次投递或串轮。 [迟到帧核验](verified-late-192-196.json)

- 205 的旧驱动被隔离身份守卫挡在启动前。206 修正驱动后，合成协议缺少审阅档位声明，宿主按规则拒绝。207 补上声明后，一张待办卡更新到修订 2，界面显示 1/2，普通 plan 没有变为计划卡，App 正常退出且渲染端无错误。 [205](attempt-205/result.json) · [206](attempt-206/result.json) · [207](attempt-207/result.json) · [界面](attempt-207/A59_NATIVE_NOTICES.png)

[逐条覆盖矩阵](覆盖矩阵.md)。
