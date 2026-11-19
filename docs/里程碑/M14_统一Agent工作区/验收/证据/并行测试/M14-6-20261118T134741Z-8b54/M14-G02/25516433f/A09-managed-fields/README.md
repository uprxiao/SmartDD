# A09 修复包保留健康的投影并拒绝未知声明字段

2026-11-19，macOS 26.6.1 arm64，签名候选 `25516433f`。复用原 082 夹具，实际原生 Claude、Codex 共四个模拟 HTTP 声明和私有项目。

- 两个已知的 HTTP 服务仍与两端实际初始化、返回真实 tools/list，实际请求头和来源鉴权完全匹配。原宿主桥仍具备工具。
- 旧包实际连接过的两份不支持的声明，本轮 HTTP 请求均为 0。两端时间线各自指出服务名、`startup_timeout_sec` 和 `tools.mandatory_test_policy`；未暴露测试字段值。
- 原配置文件哈希不变，真实 App 退出 0，零渲染错误。[完整结果](result.json) · [Claude](10-claude.png) · [Codex](10-codex.png) · [原 082 与 102 项软件回归](../../1f94f27ba/A09-http-projection/README.md)。

D06-45 实包复验通过。A09 仍需按原用例完成其余字段与表单／URL 请求。
