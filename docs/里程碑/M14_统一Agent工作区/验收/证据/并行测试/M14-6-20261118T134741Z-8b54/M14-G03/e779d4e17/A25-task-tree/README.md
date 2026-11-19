# A25 任务树与原生目标的分项实包复验

2026-11-19 07:18–07:20 新加坡时间。macOS arm64，候选 `e779d4e1703b2de07789175422ddb3b3ceafe189`，ASAR `7ea76c07ef24e3baa9339e0436d564ca8b7230b8a7ec61357792fbcff55bf988`。使用实际本机 Claude／Codex 及真实 WillYou 请求与界面，模型与业务均为本机合成测试数据。每个编号独立 HOME、数据库和项目。

| 尝试 | 实际结果 |
| --- | --- |
| 120 | 同一 Claude 父任务原回合完成时，背景进程、待批准业务、托管子任务仍在。通过实际界面打开子任务后返回，先放行背景并验证进程退出，再实际批准同一个请求并确认一次写入，最后放行原托管子及结果回流，原父回合一直保持完成。全树最终空闲，本条任务未设置目标。App 退出 0。[同场](attempt-120/01-parent-complete-three-scopes-active.png) · [逐项结果](attempt-120/result.json) |
| 121 | 尚未启动 App，默认 runner 拒绝本机合成模型端口，保留原始边界。[结果](attempt-121/result.json) |
| 122 | 独立 Codex 任务从实际输入框设置目标，真实原生 `update_goal` 的同一目标从进行中变已完成。App 退出 0。[进行中](attempt-122/06-codex-goal-active.png) · [已完成](attempt-122/07-codex-native-goal-complete.png) · [实际原生回执](attempt-122/result.json) |

130 补齐下面的同树判据。上轮 088 已在同一棵 Claude 任务树观察原目标和三项并存，未跑完后半。[既有 088](../../c098d03dc/A25-tree/README.md)

## 130 同一棵真实 Codex 任务树

为在自动续跑之前观察三项各自状态，通过真实目标卡点击暂停。原父回合完成后，真实 Codex 原生后台节点、运行中的宿主子任务和原业务审批仍同时活跃。用真实子入口并分别完成三项，原父回合状态始终完成，实际写入只发生一次。树完全收口时，同一绑定、同一修订目标仍暂停。实际点击继续后，原生 `update_goal` 回执确认同一原生 thread 与创建时间的目标完成。隔离 App 退出 0，未见 renderer 错误。

[三项同场](attempt-130/01-parent-complete-three-scopes-active.png) · [空闲且目标未完成](attempt-130/05-original-tree-idle-goal-incomplete.png) · [同一目标完成](attempt-130/06-same-codex-goal-complete.png) · [真实回执](attempt-130/result.json) · [哈希](attempt-130/SHA256SUMS.txt) · [127 夹具失败与旧驱动](../../evidence-e779d4e17-a25-attempt127/README.md) · [I 层任务树回归](../../1c9022486/a25-tree-state-i/README.md)
