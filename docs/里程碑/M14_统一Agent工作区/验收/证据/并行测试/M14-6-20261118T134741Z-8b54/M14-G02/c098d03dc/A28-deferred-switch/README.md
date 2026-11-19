# A28 原请求和排队输入收口后切执行器

macOS 26.6.1 arm64，2026-11-19，`feature/0.1.6`，修复候选 `c098d03dc`。独立打包 App、真实本机 Claude 和 Codex。模型通信限制于隔离本机合成端点。

1. 原 Claude 回合还在执行时，从同一真实任务页发送另一条输入，保留它的真实排队 ID。点模型选择器切 Codex。宿主登记待切换，原 run 和配置保持不变。[延期切换](10-switch-deferred.png)
2. 放行 Claude 的真实提问，确认请求及修订属于原 run。原排队输入仍在，界面可正常回答原请求。选择并提交后，原 Claude 回收到相同 tool call ID 的答复，随后排队输入进入同一原 run，且只有一次。[原请求和排队](20-original-native-question-with-queue.png)
3. 原两条输入均收口后实际换到 Codex。手动输入的新消息仅发送到新 run 一次。App 正常退出，渲染错误为零。[切换后](30-switched-after-original-receipts.png) · [原始时间线和身份证据](result.json) · [两个原生会话与桥进程均退出](post-exit-proof.json)

前半段切换单／多模式、在运行子任务存在时关闭新委派，以及原子结果返回新父配置已由 [原实包 030](../../../M14-G03/evidence-a88ae2016-stop-native/attempt-030/result.json)验收。[切换与投影软件回归](../../../software/a06-a10-a28-preflight/mcp-projection-switching-preflight.log)。
