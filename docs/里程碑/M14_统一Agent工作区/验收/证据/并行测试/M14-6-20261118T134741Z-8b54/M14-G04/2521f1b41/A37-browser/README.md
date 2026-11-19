# A37 真实父子正常退出和 SVN 待绑定

2026-11-19，macOS arm64。使用隔离实包 2521f1b41e07dcde0d28331f0e04fda127d80feb，ASAR ded471b0d9bb9ea4ea2fc7601b9d86c8bf6bda8f03571e091eb5a46f0830a55d。两个真实执行器只使用本机合成模型及独立网页，操作者步骤走真实后台 CDP。

- 108 复验真实父子授权。子授权前的实际读取被拒，父界面批准后同一子运行读到原父网页。子执行器实际接到授权可用通知，两边队列和待处理请求核空，再走正常退出。原生窗口日志记录两次 before-quit 和一次 will-quit，App 正常退出。原 107 的驱动提前退出与超时原证据保留。[功能及退出](attempt-108/result.json) · [原生退出时序](attempt-108/quit-phase.jsonl) · [107 原证据](../../b82556cbc/A37-browser/README.md)。
- 109 真正 SVN 工作副本内，原 Claude 已退出，另一个真实 Codex 写子仍占槽。批准后原请求保持 approved_pending_bind，未绑定 run、无可用 grant、没有把授权可用提前发给 Agent。子交槽后，新 Claude 运行实际登记，同一请求才绑定该新运行并送达可用通知。授权审计属于新运行，按其结束撤销。App 正常退出。[完整结果](attempt-109/result.json) · [批准且尚未绑定](attempt-109/02-approved-no-owner-no-grant.png) · [后继运行绑定](attempt-109/03-successor-bound-same-approval.png)。
- 109 中没有重启宿主。待绑定跨重启、绑定前停止和撤销，以及缺少实际入口的 M15 无人值守触发仍待验。[只读合并核对](verified-108-109-summary.json)。
