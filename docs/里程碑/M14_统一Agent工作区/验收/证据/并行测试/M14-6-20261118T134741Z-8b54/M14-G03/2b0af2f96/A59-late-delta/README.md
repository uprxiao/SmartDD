# A59 迟到原生流式片段复验

2026-11-19，macOS 26.6.1 arm64。隔离签名候选 `2b0af2f9604db03d8e8062e72517f4a9fb68b92e`，`app.asar` SHA-256 `a755c7c5f6e6415d69037ceca630e29e9804d3fa98ddcfd917333b146201fea1`。同一真实 Codex app-server、真实 App 后台 CDP 和回环合成响应。

196 沿用 192 的私有驱动。暂扣原生真实输出帧，等待旧 final 和终态，开始同一原生 run 的下一轮并确认已出现新文本，再释放 SHA 和大小与暂扣时一致的原帧。此时实际界面只有当前预览，旧标记没有出现，当前片段继续更新。两个原最终正文各一条，同一 run、不同 turn/item，原生终态和 SQLite 都一致。App PID 33719 与原生 PID 33974 的出生身份均已终结，App 正常退出 0。

D06-55 关闭。[原实包结果、原帧时序和退出证据](attempt-196/result.json) · [旧包反例与回归](../../1b1680eea/A59-late-delta/README.md) · [构建哈希](../../../build/candidate-2b0af2f96/package-2b0af2f96-sha256.txt)
