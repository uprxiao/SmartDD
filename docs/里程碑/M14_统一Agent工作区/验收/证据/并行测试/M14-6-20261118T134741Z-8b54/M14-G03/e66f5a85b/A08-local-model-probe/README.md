# A08 本机模型预检与首次真实尝试

候选 `e66f5a85b`，ASAR `7d6df6efc403b7e455789c492bbcc37eae74e13d7729812a75def4e3bdfd6e40`，macOS arm64，2026-11-19。Ollama 0.40.15 仅在回环监听，明确禁用云功能，使用已缓存的 Qwen3-Coder 30B 权重。预检用合成文本，在 Anthropic Messages 和 Responses 均得到实际 `verify_fixture_value` 工具调用和准确入参。服务器正常退出。未执行工具或外联。[预检原结果](real-transport.json)

425 实包、真实 Claude、真实本机模型。纳管 Skill 已在真实菜单选中。模型把任务误当作委派，七次请求均被宿主拒绝（任务未开启委派），没有子任务，也没有执行相对脚本。该批超时后原 App 和模型服务各自正常退出，两个回环端口释放。Codex 相对脚本未开始。只保存日志中与合成场景相关的摘要和原结果，隔离模型临时生成的身份文件已清理。[原生核对](425-native-verdict.json) · [文件哈希](SHA256SUMS)

外部 DeepSeek 的凭据及端点使用未获本轮自动审批，未执行该外部配方。这里是无凭据、仅本机推理的独立方案。整条 A08 保持部分验收。
