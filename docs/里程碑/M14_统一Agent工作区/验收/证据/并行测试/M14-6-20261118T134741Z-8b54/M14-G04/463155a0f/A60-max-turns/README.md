# A60 Claude maxTurns 隔离前置

2026-11-19，签名候选 `463155a0f4c2cc0fbd85ae65116f882ddb2a0a36`，真实 App 隔离启动。

181 退出码 0。开始模型回合前，夹具读回启动变量时发现实际值为空。调查定位到该批私有驱动先合并环境、再清理 Claude 的环境变量前缀，清掉了注入的轮数上限。没有启动 Claude 测试回合，不计轮数上限判据。原包和用户配置均未调整。[原始结果](attempt-181/result.json) · [退出时序](attempt-181/quit-phase.jsonl)
