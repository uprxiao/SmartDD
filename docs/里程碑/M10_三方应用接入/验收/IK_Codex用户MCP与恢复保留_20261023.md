# IK Codex 用户MCP与恢复保留

依据R1.6＋§12.21，关联T55步骤1/2/4的Codex分支。IJ真实包、Codex0.162.1，独立HOME/CODEX_HOME/userData及合成模型服务，无日常凭据。TaskService IPC创建、停止、宿主重启和恢复；不是桌面输入验收。

在原有用户Skill及profile夹具之外，增加启用的合成用户MCP，manifest路径含中文和空格。实际Codex初次会话和同native ID恢复后的模型请求均包含mcp__m10_user_marker，受管邮件MCP仍握手并完成草稿创建及恢复读取；原快照/固定包/草稿保持。用户Skill、用户MCP manifest及主config.toml逐字节不变。profile的业务字段保留，但实际Codex TUI追加已知提示状态，完整profile hash不变仍不能宣称通过。

11组局部检查通过，全部本次App/任务已清理。[原始结果及驱动快照](证据/user-mcp-resume-ik-20261023/manifest.json)。用户MCP只验证发现，没有调用其工具；模型为合成服务，未验证模型自主选择能力。Claude、精确名称碰撞、动态新增过滤及原T55全部步骤未齐，正式仍16/72。
