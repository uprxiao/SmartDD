# A70 本机真实模型联动

2026-11-19，macOS arm64，源 `9a9da26a7`，本机 Qwen3-Coder 30B，关闭云推理、只传合成数据。

573 在第一次模型推理前失败。隔离 PATH 没有 Codex 可执行命令，正式驱动临时目录未注册本机 CLI。已用相同隔离登录 shell 复现，并在 V2 改用明确的原生版本和路径。573 只记录夹具失败。Ollama 正常退出，App 由夹具对本轮进程执行退出兜底。两个回环端口均释放。 [启动夹具截图](573-isolated-fixture.png)

575 的 Claude 父目标与 SVN 实包正向通过。真实 Qwen 走真实 Claude `wy_targets`、`wy_delegate`，创建两个原生 Codex 子任务，写子等待获得共用目录资格。父任务 Stop(false) 后原进程退出，目标维持“等子任务”。只读子任务从夹具文件取得未出现在输入里的标记。写入档子任务实际获得资格并完成回合。两个真实结果交付后原 Claude 原生会话及版本恢复，App 和本机模型退出 0。 [实际自动暂停](575-01-real-local-model-wait.png) · [原目标恢复](575-02-real-local-model-resumed.png)

576 的 Codex 父任务与 Git 实包反向通过。本机真实模型调用真实宿主工具同时委派读取和写入任务。原目标暂停、共用目录写入资格交接与实际子任务结束通过，两个结果各交付一次。原 native thread、不变目标修订及活动状态均由 App 和原生协议核对，真实模型从宿主读取只读结果并返回原标记。Codex 请求历史中可再次看到已经交付的通知，冷库确认父时间线和接收回合各只有两条。[去重读证](576-notification-storage.json) App 和本机模型退出 0。 [反向截图 1](576-01-real-local-model-wait.png) · [反向截图 2](576-02-real-local-model-resumed.png)

冷重启使用新包正向 568，其它异常与权限等待分支使用已归档 A 层回归。两端真实模型证据使用本机 Qwen，Codex 和 Claude 均保留实际工具、委派和宿主落库。正式 A70 计通过。 [冷重启实包](../../../M14-G04/9a9da26a7/A70-cold-restart/README.md) [SHA256SUMS](SHA256SUMS)
