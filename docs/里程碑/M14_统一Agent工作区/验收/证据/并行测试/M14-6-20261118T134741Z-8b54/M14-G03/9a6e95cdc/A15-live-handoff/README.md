# A15 真实模型全量与增量交接

2026-11-19，macOS arm64，9a6e95cdc 候选第 354 次，Codex 0.169.0、Claude 2.1.328 和已授权 DeepSeek。用户输入和执行器切换走真实页面。中继运行只使用本次合成事实，6 个请求均获得供应商 HTTP 200。

- Codex 记 A 后切 Claude，收到全量历史并回答 A、B。切回 Codex、再切回 Claude，两个原生会话身份均不变，仅补各自未收到的条目修订，事实回答与持久化前后次序一致。四次切换都保留时间线标记。[初次全量](02-b1.png) · [切回 Codex](03-a2.png) · [切回 Claude](04-b2.png)
- Claude 在同一会话继续，没有额外交接，明确回答未知 E。最后一次回到 Codex 的负对照只在测试中继移去本轮新增交接信封，老历史仍在。测试中继核对被移除的唯一交接 ID、请求前后摘要和实际发出的事实集合。实际模型仍答对 A、B，对被移去的 D 回答 UNKNOWN。[同绑定控制](05-same-binding-control.png) · [负对照](06-withheld-increment-control.png)
- 原始驱动验证六个业务回合后，正常退出 App，收尾误要求所有原生进程均有额外的业务 CLI 登记。Claude 两代的主原生 PID／出生身份在 capability_runs 中，Codex 原生及桥也有额外登记。按同一结果与只读数据库复核原绑定、6 个原生回合、4 个交接和吻合的回答。独立进程身份探测核对 5 个原生进程、全部已登记桥及 App 均已退出。原始结论和独立修正并存，未重新送出任何模型请求。[原始轮次](result.json) · [独立核对](verified-business-and-release.json) · [核对脚本](verify-a15-354.py)

结合已有 U／I 结论，A15 通过。
