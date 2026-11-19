# A06、A10、A28 实包驱动预检

2026-11-19，macOS arm64，`feature/0.1.6`，源码提交 `2521f1b41`。预检期间 M13 全量占用原生测试槽，三个驱动尚未启动隔离 App，正式用例状态不变。

- A06 检查本机模拟服务的两种 SSE 响应与当前输入提取。实包将用隔离任务并发核对 Claude 401、Codex 正常对话和另一 Codex 配置的代理失败。[离线检查](a06-fixture-preflight.log)
- A10 用实际 M13 MCP 启动脚本和合成环境值执行同一 stdio 进程。直接启动的负对照看得到合成运行变量，通过启动器时只收到配置给 MCP 的合成变量。输出仅含判定值。仍需核对两端 M14 是否在新任务里接入纳管配置与过滤。[直接启动](a10-unfiltered.json) · [生产启动脚本](a10-filtered.json)
- A28 准备在当前回合仍进行时请求切换，并由原 Claude 会话发出真实原生提问。实际回答和已有排队输入应保留原 owner，下一条新输入再发给 Codex。
- MCP 投影、MCP 发现、请求切换的 3 个软件测试文件合计 75 项通过。三份驱动的 Node 语法预检和 7 条静态 CDP 表达式全部通过。[测试日志](mcp-projection-switching-preflight.log) · [CDP 预检](cdp-preflight.jsonl) · [驱动校验值](private-driver-sums.txt)
