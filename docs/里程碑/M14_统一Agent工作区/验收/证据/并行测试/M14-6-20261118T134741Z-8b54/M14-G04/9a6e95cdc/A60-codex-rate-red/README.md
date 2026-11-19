# A60 Codex 短期限流红测（第 365 次，M14-D06-63）

2026-11-19，Claude Code 执行。隔离包 `9a6e95cdc`，真实本机 Codex 0.169.0 连接本机合成 Responses 服务。场景 `codex-rate`：暖机一轮正常，测试轮每次都回 429 `rate_limit_exceeded`，带 `retry-after: 1`，不带额度头。

- Codex 原生退避，6 秒内重试 6 次后结束这一轮。原生 `task_complete` 中错误为 `exceeded retry limit, last status: 429 Too Many Requests`，结构化信息为 `codex_error_info.response_too_many_failed_attempts.http_status_code = 429`。
- 宿主记录为 `code: responseTooManyFailedAttempts`，回合状态 `failed`，没有 `limited.kind = rate`，界面显示为普通失败。需求 R02 和技术方案 §9 要求把限流和普通失败分开显示。
- 原因：`src/main/core/agent/timeline.ts` 只把 `rateLimitExceeded`／`tooManyRequests` 识别为限流，没有读取 `responseTooManyFailedAttempts`（以及同类带 `httpStatusCode` 的错误）中的 429。
- App 正常退出 0，3425 已释放。

[原生与宿主对照](native-vs-host.json) · [原始结果](result.json)

驱动：私有目录 `g04/a60-native-limits-packaged.mjs`，未改动，参数 `codex-rate`。修复后用同一驱动、同一场景在新包上复验。
