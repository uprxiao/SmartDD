# A31 共用目录 FIFO 与目录身份

2026-11-19（UTC+08:00），macOS arm64 签名实包 `15be1a81e`。实际 Codex app-server 使用本机合成模型响应。本轮两个项目使用实际 symlink 和子目录入口，随项目及任务创建走现行路径解析。

- Git 共用目录：[实际证据](attempt-069/result.json) · [共同排队](attempt-069/11-two-parents-both-writers-queued.png) · [改向后拒绝](attempt-069/31-redirect-native-rejected.png)
- SVN：[实际证据](attempt-070/result.json) · [共同排队](attempt-070/11-two-parents-both-writers-queued.png) · [改向后拒绝](attempt-070/31-redirect-native-rejected.png)
- 普通目录：[实际证据](attempt-071/result.json) · [共同排队](attempt-071/11-two-parents-both-writers-queued.png) · [改向后拒绝](attempt-071/31-redirect-native-rejected.png)

每类两个写子依次拿到同一物理根的 FIFO。后父先退出仍等第一位，第一实际写入结束才放行第二，原生结果分别回原父。原授权根之外的私有目录改向试验未启动该子原生运行，旧队列注销，原数据和目的目录均未写入。三次 App 退出 0，renderer 无错误。独立任务并行和受宿主限制的只读子用 [A30 三目录实包](../../68fbd2c79/A30-directories/README.md) 对证，U／I 用 [Agent 回归](../../../software/a55-method-probes/a55-all-agent-regression.log) 对证。
