# A06 既有未知写入遇到供应商 401 后恢复

2026-11-19，macOS 26.6.1 arm64，签名候选 `1f94f27ba`。真实 Claude 和原生 MCP 通过本机合成模型与零连接测试插件操作一个隔离文件。该实例与 A06 的两条供应商故障矩阵使用独立数据。

1. 在 App 实际发送、点批准，插件把合成效果持久化。结果回包仍扣住时，本轮按计划故障终止旧测试 App。重启后同一逻辑任务保留原 operationId，活动账为结果未知，排队输入未自行发出。[准备及未知状态](attempt-093/101-local-effect-unknown-after-restart.png)
2. 在原任务实际点立即发送，同一选中供应商／模型接收真实请求并返回合成 401。原生错误正确分类，原未知写仍只有一条调用与一份原效果。[401 同任务](attempt-093/102-authentication-failure-with-original-unknown-effect.png)
3. 原任务手动发送新的纯文本，在同一个配置从同一端点恢复。原 operationId、请求、调用以及效果文件摘要不变，未重放。重启实例正常退出，校验 checkpoint 后仍只有同一个 unknown 调用。[恢复与完整判据](attempt-093/result.json) · [恢复页面](attempt-093/103-recovered-without-unknown-write-replay.png)

[092 原始夹具失败](attempt-092/seed.log)发生在默认测试宿主禁止嵌套 macOS 沙箱时，App 尚未启动。093 使用本机验收执行器，产品按原隔离规则实际启动插件。[原生故障、健康会话与配置隔离](../../../M14-G02/1f94f27ba/A06-provider/README.md)提供 A06 其余实包判据。
