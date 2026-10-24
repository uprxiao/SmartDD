# IM：Codex 精确同名 Skill 冲突与恢复

依据 R1.6＋§12.21，覆盖 T55 的 Codex 精确 Skill 名称冲突分支。实际 IJ 打包 App、Codex 0.162.1，独立 HOME/CODEX_HOME/userData 与合成模型；通过生产 TaskService IPC/PTY 执行，不计 UI 验收。

用户所有的合成 Skill 使用实际邮件包生成的完整名称。启动后明确诊断 AGENT_CAPABILITY_NAME_CONFLICT，邮件工具命名空间未注入，调用与草稿副作用为零；Codex 普通响应仍成功，用户文件字节未变。测试所有者将该合成目录移到发现根之外后，原 Task 恢复，同一原生会话 ID、固定快照及包版本保留，实际 M10 bridge 连接成功，原文件仍保留。共 6 组检查通过，独立实例已清理。

首次运行失败保留：脚本取了原生 ID 绑定前的 snapshotHash，恢复时与绑定后的合法快照不一致。修正为停止且绑定完成后取基线，再运行通过；这是驱动基线时序错误，不是改变产品预期。主配置字节不变；profile 业务字段保留，Codex TUI 自身提示写入单列。

[原始红绿结果、驱动快照及哈希](证据/skill-conflict-im-20261023/manifest.json)。包与生产输入沿用 [IJ 基线](IJ_激活竞态修复打包复验_20261023.md)。本次仅证明恢复后 bridge 连接，未证明解除冲突后实际业务工具调用；后者继续补验。完整 MCP key／插件冲突、动态新增过滤和 Claude 分支未齐，T55 保持部分执行，正式 16/72。
