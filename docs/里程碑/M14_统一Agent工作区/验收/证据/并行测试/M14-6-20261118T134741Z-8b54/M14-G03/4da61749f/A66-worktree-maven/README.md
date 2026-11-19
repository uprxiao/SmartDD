# A66 Git 独立工作副本与后台写者

2026-11-19 新加坡时间，macOS arm64，冻结源 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`，ASAR `39351e634975433afb8034cda4e3a387fbd534b3f982ad56b3f88e062864dbc4`。真实本机 Claude/Codex，从独立合成 Git 仓库的 `packages/web` 启动；无远程，Model 端点在本机。

- 135 的父模型夹具错误要求工具结果仍带首条输入全文，断在第一次真实 `wy_targets` 返回。原 App 正常退出。136 的夹具以匹配的原生 tool call ID 核对后续响应，同时用原 135 的独立工具结果形态做正例、错 ID 做负例。[135 原始失败](attempt-135/result.json) · [离线预检](preflight.log)
- 136 的业务判据已取证。父留在同一实际回合，两个子从同一 HEAD 建不同的独立工作副本，映射 `packages/web`；Maven 不执行包管理器安装。两个同名子分支按规则加后缀，主目录未提交内容没有进入子目录，父继续写主目录，HEAD 不变。子前台回合完成时实际后台写者仍在，两类完成通知及子提交均未提前发。后台退出后两个原生子各有一条带 `WillYou-Intent` 的宿主子分支提交和一条完成通知。未登记自建夹具路径保持未绑定。[两回执](attempt-136/01-parent-original-with-two-independent-receipts.png) · [待后台](attempt-136/02-child-foreground-complete-background-writer-active.png) · [独立提交](attempt-136/03-host-only-child-commits-and-one-notice-per-child.png)
- 136 撤场时，第二条子结果唤醒的父回合仍显示工作中。夹具此时请求退出，未等待该回合收口，在固定时限后只清理本轮隔离 App，不能把这次退出当作正常完成。真实工作副本、提交与通知回执已保留。对应的原任务与回执收口后再复验完整撤场。[完整未通过结果](attempt-136/result.json) · [日志](attempt-136/electron.log)

A66 尚含其他档位、依赖类型、故障和真实模型判据。此处按已观测定向记录，整条仍待验。

## 后续 npm 失败与正常退出

| 尝试 | 限制与结果 |
| --- | --- |
| 137 | 流程实际写入并提交，退出前新加的只读检查误传任务对象，保留参数错误与正常退出。[原始结果](attempt-137/result.json) |
| 139／143 | 实际前台与两子结果已收口，夹具仍把后续宿主的合并核对状态通知当成父初始命令回合，造成模型夹具错误，测试运行按保护路径结束。原产品通知被保留，退出返回 0。[139](attempt-139/result.json) · [143](attempt-143/result.json) |
| 144 npm 失败 | 两个独立工作副本的本机离线 npm 安装实际失败，两个真实子任务都收到失败说明并仍然启动，各自提交，原父与子结果通知正确。父未执行本条范围外的合并，状态为“需要处理”。夹具误要求父任务总体完成而超时，但只读磁盘核验原父、两子、两条结果通知和两条合并核对的 7 个回合均已完成，无停止补偿，真实 App 退出 0。保留原结果与独立核查。[原结果](attempt-144/result.json) · [退出后回合状态与哈希](attempt-144/verified-settled.json) |

Maven 与 npm 失败的定向证据保留各自边界。本条还需其他档位、依赖类型、故障与真实模型矩阵。

147 通过 detached HEAD 的独立 App 流程。两个真实子任务从同一原基准提交创建，以短 SHA 命名各自分支，第二分支有 -2 后缀；两端 Maven 子目录均跳过 JS 依赖安装，父目录和原 HEAD 保持各自状态，子后台退出后才提交各自分支。两条真实结果通知收口，App 正常退出 0。[原始行为与收尾](attempt-147/result.json) · [校验清单](attempt-147/SHA256SUMS.txt)
