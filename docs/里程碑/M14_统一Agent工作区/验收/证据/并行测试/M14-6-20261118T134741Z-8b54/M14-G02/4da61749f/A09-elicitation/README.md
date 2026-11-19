# D06-47 外部 MCP 请求修复包复验

2026-11-19 08:20–08:21 新加坡时间。macOS arm64；冻结源 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`、ASAR `39351e634975433afb8034cda4e3a387fbd534b3f982ad56b3f88e062864dbc4`。保留外部 MCP 的原始回环请求和双方真实原生回执。使用两个独立 App、隔离账号和测试项目，真实点击统一请求面板中的选项和确认。

| 尝试 | 实际验证 |
| --- | --- |
| 132 表单 | 同样的原始 `pattern` 仍经真实 MCP 发出。Claude 与 Codex 都在 App 显示来源和说明，只有取消选项，没有编辑字段或提交入口。实际选择取消并确认，服务器两次都收到 `{action:"cancel"}`，两端原回合完成，App 退出 0。[Claude](attempt-132/request-claude.png) · [Codex](attempt-132/request-codex.png) · [实际结果](attempt-132/result.json) |
| 133 URL | 两端都显示同一个合成回环 URL 作为文本，只有取消选项。实际确认后服务器两次收到原生 cancel，零网页访问。两端原回合完成，第二个 App 退出 0。[Claude](attempt-133/request-claude.png) · [Codex](attempt-133/request-codex.png) · [实际结果](attempt-133/result.json) |

关闭 D06-47。未扩大第三方 MCP 支持边界，也未把两项回归计作 A09 或 A11 整条通过。A09 的 argv／cwd／禁用项继续单独取证。

[旧包](../../e779d4e17/A09-elicitation/README.md) · [新包哈希](../../../build/candidate-4da61749f/package-4da61749f-sha256.txt) · [驱动哈希](SHA256SUMS.txt)
