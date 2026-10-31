# IL Codex 用户MCP实际调用保留

R1.6＋§12.21，补T55的Codex保留能力证据。复用IJ真实包、Codex0.162.1、私有HOME/CODEX_HOME/userData及合成模型服务。此次合成模型在初次会话、同native ID恢复后的会话各明确请求用户MCP的只读fixed_marker；实际Codex返回两份工具输出，均含原manifest SHA256与user-owned-preserve标记。

随后原受管Skill读取、邮件草稿创建和恢复读取仍通过。主config、用户Skill及manifest字节保持，profile仅保留既有原生TUI提示写入边界。11组检查通过，含上述两次用户工具调用；不能把两次调用额外计作正式用例。用户MCP与受管应用同时启用，没有临时禁用任一方来获取成功。所有本次App/任务清理完成。

[原始工具结果、原生版本及驱动快照](证据/user-mcp-call-il-20261023/manifest.json)。模型为合成服务，输入为TaskService/PTY层，不是UI或真实模型推理。Claude、精确名称冲突及动态新增过滤仍待补，T55不计完整通过，正式16/72。

下一步已核对applicationNativeSkillName规则及原应用范围冲突单测：优先补真实Codex同名Skill保护/解除冲突，保留用户字节与原会话身份，不能从本轮普通共存推断冲突通过。
