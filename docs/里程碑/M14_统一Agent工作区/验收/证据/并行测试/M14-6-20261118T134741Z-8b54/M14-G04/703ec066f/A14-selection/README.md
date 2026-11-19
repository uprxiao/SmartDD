# A14 模型、Provider 与目标按任务隔离

2026-11-19，macOS arm64，冻结候选 `703ec066f36e10ffb490b19f818b385641de19ad`，ASAR `cb65cbeb53d8145a8dd80972ecb76ec3a09425ad0926808bdb61cdaa7c2b078b`。实际 Claude、Codex 与本机合成服务。通过后台 CDP 操作实际控件，读取原生和宿主回执。项目与任务分别用独立测试数据。

- 164 已通过同一档案换模型的原生应答，实选同执行器的 Provider B、再切到 Claude 时草稿和历史保持。试验脚本使用的后台全选快捷键没有选中整份旧草稿，Backspace 实际只删了末尾一个字符，后续等待超时。原 App 正常退出。[原始报告](attempt-164/result.json) · [草稿仍在界面](attempt-164/M14-A14-selection-scope-failed.png)
- 166 改为直接发送切换全程保留的输入，从独立数据重跑。两轮 Codex 请求实际使用不同模型，原运行 ID 不变。实际换 Provider 和跨到 Claude 后，原历史和草稿保留，发送草稿得到真实 Claude 回答。两端实际目标分别锁定切换，同一档案内可换模型。Codex A 和 B 的同文目标独立，暂停或清除 A 仍保持 B 锁定，A 再建同文目标重新锁定。隔离 App 正常退出，无界面报错。[实包结果](attempt-166/result.json) · [草稿和历史](attempt-166/01-switches-preserve-draft.png) · [暂停后的锁定](attempt-166/02-paused-task-locked.png) · [同文新目标重新锁定](attempt-166/03-new-identical-goal-locks-again.png)

本轮未触发目标等待子任务而自动暂停的分支。过期预检、在途派发和跨执行器委派等仍按本条完整合同分别归证。
