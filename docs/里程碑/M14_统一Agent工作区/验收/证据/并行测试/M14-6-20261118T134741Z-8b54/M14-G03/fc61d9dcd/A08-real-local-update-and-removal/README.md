# A08 实际模型运行及删除来源反例

2026-11-19，macOS arm64，隔离包 `fc61d9dcd`，ASAR `3fe7e5cb995ffed2de34ec9fc393b6450e2feb414fee0e5c2ff44a85ba7a1427`。本机 Ollama 0.40.15 运行已缓存的 Qwen3-Coder 30B，关闭云、使用合成数据。Claude、Codex、本机 App 为实物。Codex Responses 回环转发只去掉本场无关、Ollama 无法解析的 freeform `apply_patch` 声明。原生 `exec_command` 保持。

- 431 的原生 Codex 从实际 `$` 菜单选择 Skill、按请求批准运行相对脚本。工具结果与模型回答含同一标记。更新后的新任务也从菜单选到 Skill，但驱动只允许某一种 shell 参数引号，拦下本来合法的第二次命令。原始结果保留失败。[原生 Codex 正向](431-codex-0-result.png)
- 432 的原生 Claude 对原始、更新后的两个 Skill 版本，都通过实际菜单选择、按请求批准运行相对脚本并返回各自准确标记。两次均核对来源内容只受夹具写入影响。[原始](432-claude-0-result.png) · [更新](432-claude-1-result.png)
- 432 删除受管 Skill 来源后新建任务，旧包启动失败，新鲜任务未发出模型请求。[启动失败截图](432-99-failure.png) 从 SQLite 可看到 `OPEN_FAILED_UNFORKED` 和“原生能力配置尚未完整核验；本次不覆盖用户能力配置”。根因是遍历 Skill 时悬空软链接产生 `ENOENT`，整层捕获为 `path_unreadable`。`9a9da26a7` 忽略已不存在的单项，继续核对其他项目。红测明确观察旧诊断，修复后 60 项定向和 609 项相关回归通过，9 项依原条件跳过，新包实测待记。

两次实包与模型进程均退出 0。整条 A08 仍待新包验证，未计通过。[SHA256SUMS](SHA256SUMS)
