# A09 外部 MCP 表单与 URL 的原生对照

2026-11-19，新加坡时间。冻结 macOS arm64 候选 `e779d4e1703b2de07789175422ddb3b3ceafe189`，ASAR `7ea76c07ef24e3baa9339e0436d564ca8b7230b8a7ec61357792fbcff55bf988`。测试调用来自真实 Claude SDK／本机 Codex app-server 与打包界面，MCP 和模型端点均为本机合成服务。未导航或同意任何 URL，也未提交表单内容。

| 尝试 | 结果 |
| --- | --- |
| 125 | 原模型夹具要求每个请求的最后一条 user 内容带提示标记，Claude 工具结果却成为最后一条。已保存实际新一轮请求形态。夹具因此停在 Claude 未结束的回合，测试 App 强制退出，残留隔离进程在后续检查时已结束。Codex 观察也保留，仅用 128／129 判断产品缺陷。[原始结果](attempt-125/result.json) |
| 128 表单 | 两端实际收到同一个原始发出形态，`pattern` 发出时存在。Claude 在没有宿主回调的情况下直接向 MCP 返回 decline，用户看不到请求。Codex 回调丢失了 pattern，App 仍显示可输入的字段和提交入口，实际选择拒绝。两端回合完成，App 正常退出 0。[原始请求、回调、结果](attempt-128/result.json) · [旧包表单](attempt-128/request-codex.png) |
| 129 URL | 两端收到同一个仅本机的 URL。Claude 自动 decline，Codex 仍显示可用提交按钮，用户仅选择拒绝，原服务器没有收到网页请求。两端回合完成，App 正常退出 0。[原始结果](attempt-129/result.json) · [旧包 URL](attempt-129/request-codex.png) |

D06-47。按 [F05 已确认范围](../../../../../../../技研/实验/20261114_F05MCP字段与请求边界验证/README.md)处理：外部表单原始约束无法核验时不得提供接受。当前 URL 流程只支持取消。已在 `4da61749f` 增加 Claude 回调，将两个驱动的该请求都接到统一面板，并只向原请求返回 cancel。待新实包复验。
