# A06 供应商故障隔离与恢复复验

2026-11-19，macOS 26.6.1 arm64，候选 `1f94f27ba`。真实 Claude 与 Codex，各自隔离配置和工作目录，模型替身在本机。记录 401／502 以及对应配置信息，未使用外部服务或真实账号凭据。

- 079 在已验证的隔离 App 里显式设置非凭据参数 `CLAUDE_CODE_MAX_RETRIES=1`。旧 App 的 Claude 401 和独立 Codex 502 均产生终态。健康的 Codex 原会话持续答复。恢复发送时，Claude 交接请求包含旧标记和当前标记，模型夹具误取第一个而再次返回 401。用原实际请求中的标记顺序验证新路由选中当前输入。App 正常退出。[原结果](attempt-079/result.json) · [实际输入的标记回放](attempt-079/routing-marker-replay.json)
- 080 保留相同隔离和重试夹具。实际 401 与 502 分别归原配置。继续发送时，健康 Codex 始终是同一原生 run，故障 Claude 用其原选配置恢复，进入模型的只有预期本机请求，并返回正确新输入。App 退出 0，渲染错误为零。[实包结果](attempt-080/result.json) · [401 时任务](attempt-080/01-original-401.png) · [502 且未跨配置](attempt-080/02-proxy-failed-without-lane-fallback.png)

原生 API 默认重试的 [075 和 077](../../c098d03dc/A06-provider/README.md)保留。A06 仍待独立验证已有未知写操作时的同任务恢复与不重放。
