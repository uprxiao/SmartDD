# A08 Claude 实际执行相对资源

2026-11-19，macOS arm64，隔离实包 `fc61d9dcd`，ASAR `3fe7e5cb995ffed2de34ec9fc393b6450e2feb414fee0e5c2ff44a85ba7a1427`。本机 Ollama 0.40.15 对已缓存的 Qwen3-Coder 30B 推理，云关闭，无外部端点和真实 Key。App 和 Claude CLI 都为原装。

428 从 `$` 菜单实际选用，模型调用 `Skill`，按请求批准只读取同一合成来源的 `SKILL.md`，再在原生 Bash 执行其中指定的相对脚本。原生终态、产出和收到的工具结果均含同一合成标记。[真正执行后的界面](claude-0-result.png)

Codex 整例未通过，Ollama Responses 拒绝了原生工具列表的 freeform `apply_patch`，其暖机未开始。426、427 分别保留夹具未白名单已选说明路径、没有区分 Claude command_approval 的历史失败。三个 App 和三个本机模型进程均正常退出。临时身份文件已清理。[SHA256SUMS](SHA256SUMS)

未运行完第二个原生执行器及更新／删除，正式 A08 保留部分通过口径。
