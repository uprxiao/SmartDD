# M14-A29 原生子与宿主子合并证据

最新实包提交 `1c9022486b5425bd8a092e99506b0c99aa6a81e0`，macOS arm64，`app.asar` SHA-256 `6ea0906fe3d56d93d39b42be6d9458fc99458707bdecd0a54115fcfc637d4604`。所有 App、项目、模型配置和本机套接字分离。Claude 2.1.326 与 Codex 0.169.0 使用真实原生进程，模型响应为本机合成。实际产品操作用绑定实例的后台 CDP。旧候选的补充证据注明提交，以本轮修复实包复验为准。

| 判据 | 实际结果 | 证据 |
| --- | --- | --- |
| Claude 原生子与宿主子各自身份、问题与结果 | 原生子结果留在对应原生工具和历史，宿主子进入自己的时间线，真实提问带自己来源并实际收到选择答案。general-purpose 原生子的实际公开工具清单缺 `AskUserQuestion`；只记录这个运行器和子类型的能力事实。 | [Claude 两类身份、真实问题、结果与工具列表](claude-both-sources/result.json)，[宿主子时间线](claude-both-sources/70-a29-claude-host-separate-timeline.png) |
| Codex 原生子与宿主子各自身份、问题与结果 | `5d211c705` 的 022 有真实 Codex 原生节点与三条宿主结果，原生标记仅在原生子历史。Codex 父的 014 同时接收两个 Claude 宿主子同文问题，两个子分别实际收到各自答案。038 调真实 Codex 原生子工具 `request_user_input`，该版本明确拒绝非根线程，WillYou 没有生成原生待处理请求。038 的初始记录曾只扫全历史造成选项文本误判，已用原始 rollout 同 call ID 纠正。 | [Codex 两类节点与结果](codex-native-and-host-independent/result.json)，[两个宿主子问题](codex-parent-two-host-questions/result.json)，[真实原生拒绝及 App 数据库 0 请求](attempt-038/native-tool-matched-receipt.json) |
| 只读抽屉、左右布局、×／Esc | 两侧实包的浅 1440×900、深 1440×900、浅 1000×760，抽屉均隔开消息区、没有遮罩、左侧可交互，×／Esc 均可关闭。Codex 022 实际点左栏进入宿主子任务，抽屉打开自动收起关系卡。 | [Claude 浅](claude-both-sources/60-a29-claude-native-0-light-1440.png) · [深](claude-both-sources/60-a29-claude-native-1-dark-1440.png) · [窄](claude-both-sources/60-a29-claude-native-2-light-1000.png)；[Codex 浅](attempt-037/90-a29-codex-native-0-light-1440.png) · [深](attempt-037/90-a29-codex-native-1-dark-1440.png) · [窄](attempt-037/90-a29-codex-native-2-light-1000.png)；[真实左栏导航](codex-native-and-host-independent/22-a29-left-sidebar-navigation.png) |
| 无节点级能力时按所属 run 停止 | Claude 034 真点击后原运行停止且父轮 interrupted。历史抽屉在当前切到另一个实际 Codex run 时不提供停止，旧 ID 即使直接调用也被拒。Codex 037 真点击所属运行后父轮先中断，原生子仍活跃，继续保留原先计时。10 秒前没有强停按钮；首次见于 +10,157 ms，之后再等 1,090 ms 不点仍保持原 PID 与排队；实际点击后原 PID 退出、原生子 interrupted、旧历史停止权空，排队用户输入未发。 | [Claude 真点击](claude-active-owning-stop/result.json)，[历史抽屉](claude-both-sources/73-a29-history-with-new-owner.png)，[Codex 强停前](attempt-037/96-a29-codex-force-available-native-still-active.png) · [强停后](attempt-037/97-a29-codex-force-finished-parent-queue-retained.png) · [真实宿主时序](attempt-037/owner-stop-timeline.json) |

当前两个驱动的 WillYou 能力表都未声明节点级定向停止。Codex 父的模型可能见到 `close_agent`，Claude CLI 模型可能见到 `TaskStop`；两者都不代表 WillYou 具备经探测验证的节点级控制。用例补验以当前声明的回退边界为准。Codex 父场景中已实测的宿主子执行器是 Claude，另以 Codex 作为宿主子发起实际问题没有本批证据。

037 与 038 App 均正常退出 0，无 signal、渲染异常或四个记录 PID 残留。038 在真实工具拒绝后不能完成请求 UI 步骤，驱动超时独立保留；离线用原记录确认无误并检查拒绝路径。系统层输入、真实模型和阶段整体验收比例由协调者单独维护。
