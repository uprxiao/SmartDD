# A25 实包 088 部分判据与夹具失败

2026-11-19，macOS arm64，候选 `c098d03dc`。真实本机 Claude、Codex、Bash 后台进程、由原生桥发起的零连接业务插件请求。模型响应由隔离本机夹具提供。

同一父任务的原始用户回合已完成，后台 Bash 仍活跃、受信任的 Codex 子还在执行，插件审批在等待。目标处于等待子任务状态。真实点击运行中的子任务卡可进入子任务，返回后仍能找到原请求。[共同现场](01-parent-complete-three-scopes-active.png) · [子任务可达](02-running-hosted-child-reachable.png)

释放后台后收到原生通知，夹具没有处理 Claude 随后的内置目标判定请求，在批准业务、结束子任务和检查整树空闲之前失败。原环境保留，App 退出 0，相关子进程和监听已核对收尾。[原始结果与收尾](result.json) · [失败截图](99-failure.png)
