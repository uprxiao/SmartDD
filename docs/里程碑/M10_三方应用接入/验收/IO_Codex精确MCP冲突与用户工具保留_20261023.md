# IO：精确 MCP key 冲突及用户工具保留

依据 R1.6＋§12.21，接续 T55。IJ 实际打包 App、Codex 0.162.1、macOS arm64；独立 HOME/CODEX_HOME/userData，合成模型，生产 TaskService IPC/PTY 与真实 MCP。生产代码未变，复用 IJ 包。

完整重走 IN Skill 冲突与恢复后，停止原会话，在独立用户配置内加入与当前 Task 应用桥精确同名的 MCP key（按实际 task digest 生成）。恢复同一会话后，邮件显示 AGENT_CAPABILITY_NAME_CONFLICT，应用成功调用数为 0；用户 MCP 的 fixed_marker 经实际 Codex 调用成功，返回原 marker 和 manifest SHA256。用户配置字节未被宿主改写，原会话 ID 和快照未变。

由测试所有者显式保存并移除这一合成冲突配置段，随后同 ID、同快照恢复实际应用 bridge。此动作仅是测试夹具解除冲突，不代表宿主自动删改用户配置。最后恢复阶段未再调用业务工具；此前 IN 与本轮前半段已证明 Skill 冲突恢复后的 draft_list 调用。

最终 9 组检查通过、exit 0，测试实例已清理。两次失败全部保留：首次等待 currentRun 消失后立即恢复，后台运行尚未 stopped，得到 RESOURCE_BUSY；改为确认 recentRuns 均终态。第二次用户工具实际成功，但输出为 input_text 数组，驱动误按字符串 includes 判断；按实际响应格式读取后通过。未修改产品或降低预期。

[红绿结果、原始工具输出、驱动快照及哈希](证据/mcp-conflict-io-20261023/manifest.json)。本轮属于服务集成／真实 CLI，不是 GUI 或真实模型推理。完整插件冲突、动态新增过滤及 Claude 分支仍待补，T55 保持部分执行，正式16/72。
