# A26 第 049 次实包复核

实包候选 `216acf6a7bf486f9031a836dea957f94ccf7d76b`，ASAR SHA-256 `5f088304047e4db029346b69b594d226a98082a690916de7d6bd1c26733d3821`。2026-11-19 macOS arm64，Codex 与 Claude 为本机真实执行器，模型回包限回环合成文本。实际 App PID 27734 正常退出 0、无渲染错误，3425 和包进程核空。

同一宿主子任务的三轮均完成。通过实际下拉选择 `ask → full → ask`，两次可信 change 事件和首次完全访问确认留存。每次改父档时原正在运行的子 run、turn 和原生上下文保持。按同一任务的真实回合 ID 在原生 rollout 读取，三轮 `审批／沙箱／审查人` 分别为 `on-request / workspace-write / user`、`never / danger-full-access / user`、`on-request / workspace-write / user`。同一任务使用同一宿主 binding、同一个真实 Codex thread；每轮启动的本机进程世代为 1、2、3，并各自正常停止。真实 MCP 的两次跟进也保留原收据和子任务身份。

驱动误要求三轮的本机进程 runId 相同，因而在已完成的三轮之后以失败状态退出，未开始新任务的四个初始继承组合。现行验收要求原正在运行的轮次保持自身权限，以及同一子任务的下一轮采用新档；没有要求三轮之间保持同一个本机进程。这是驱动断言错误。原失败、退出清理及原样驱动保留。初始组合和实包的四类请求并存仍须另验。

[精确权限与原生线程记录](attempt-049/native-verified-summary.json) · [同一父改完全访问而首轮继续](attempt-049/01-parent-full-first-child-running.png) · [同一子次轮继承完全访问](attempt-049/02-child-inherited-full.png) · [同一子第三轮回到请求批准](attempt-049/03-child-inherited-ask.png) · [原驱动结果](attempt-049/result.json) · [SHA-256](SHA256SUMS)
