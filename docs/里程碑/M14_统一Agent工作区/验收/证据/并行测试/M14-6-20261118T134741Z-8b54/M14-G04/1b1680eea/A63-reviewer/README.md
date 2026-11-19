# A63 原生配置中的自动审批与请求批准档位

2026-11-19，macOS 26.6.1 arm64，隔离签名候选 `1b1680eea`，真实本机 Codex 0.169.0、真实 App 后台 CDP、本机合成模型响应。状态目录由本次验收单独创建，没有使用日常账户。

195 的实际首轮命令进入用户请求面板，拒绝后测试文件未写入。原生 `thread/start` 与 `turn/start` 均明确含 `approvalsReviewer: user`，生效配置记录来源为 sessionFlags。旧驱动误把私有托管 TOML 整文件哈希不变设作断言，Codex 在测试目录追加项目 trusted 元数据后夹具提前退出。顶层默认 `auto_review` 保留，App、原生执行器及桥均已结束，App 正常退出 0。恢复后正反审批组合待重试。 [原始结果](attempt-195/result.json) · [实际原生面板](attempt-195/A63_INITIAL_DENIED-request.png)
