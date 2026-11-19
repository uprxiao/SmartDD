# M14 A25 父回合和树汇总 I 层补测

冻结 1c9022486 的实际 AgentStore、TaskService、RunService、DelegationService 和 HostBusinessRequests。本地内存 driver 供应原生后台及目标事件，模拟业务批准只计入内存一次。电子 App 与合成模型服务均未启动。

[结构化观察](witness.json)和[测试日志](baseline.log)显示五个状态。父原回合先正常完成，仍有待批请求、独立后台节点、运行托管子，目标暂停。批准收口后整树仍在工作。原生后台结束后托管子仍在工作。托管子回流、消费一次通知后整树已完成，目标恢复为进行中。只有收到原生目标的明确 complete 后目标才完成。各步父原回合保持 completed。

此测试走真实服务汇总和请求保存，未操作打包 App、截图或真实原生后台工具。A25 的组合 A 验收仍待执行。
