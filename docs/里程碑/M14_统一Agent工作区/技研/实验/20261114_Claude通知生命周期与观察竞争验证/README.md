# Claude 通知生命周期与主动观察竞争

2026-11-14；R02／03／05／06／11／12，Q01／04／24／25／28。技术方案 §7.2.5，验证账 §4.63。仅独立研究，无产品／原型修改。

## 方法与新的观察

使用 Claude Agent SDK 0.3.321、固定 native 2.1.321、实际程序化 owner／配置修订／冻结执行计划和 gated launcher。父 task／binding 是候选表，结果为 seeded 合成正文；观察通过宿主直接调用 read／ack，模型服务仅 localhost。

初次 attempt-KnJgsM 三项通过后，原始帧显示：模型输出之前已出现 command_lifecycle queued／started，以及带 user_message_uuids 的 system/init、requesting 状态。不能据“没有流输出”推断没有可用原生回执。保留初次证据，增加能力声明和生命周期验证；最终 attempt-1MLYiP 四项通过。

## 检查结果

| 检查 | 结论 |
| --- | --- |
| C01 | SDK 输入迭代已 yield、本机模型已收到请求，但候选故意未持久化任何原生回执。直接 read／ack 不清除 sending；结束原生 run 后仍阻止切换，对账 unknown 后也不自动放行。此为回执未落库窗口，不是“CLI 没发 ACK”的证据 |
| C02 | 实际首个 message_start stream_event 带原输入 UUID 和原 session_id，可在终态前关联接受。私有发送句柄、原会话、输入回声、主线程条件均验证；重复同帧幂等 |
| C03 | 实际匹配的 success result 后到，单独证明该合成回合完成。重复结果观察不覆盖接受记录；原 run 排空后允许切换 |
| C04 | 实际 init 声明 msg_lifecycle_v1，原 command_uuid／session_id 的 queued 和 started 在无任何模型输出时可分别留证。不需要一直等模型输出。能力缺失、错误输入、复制句柄和 completed 冒充启动均拒绝；重复 queued 不增加事件 |

最终三次 native 启动／三次本机模型请求；初次两次均保留，共五个自有 native 退出码 143，所有 run stopped。143 来自实验的受控 SDK close／SIGTERM 收尾，不按业务成功回合解释。最终只有 C03 要求真实 SDK success result；其余路径有意保持模拟响应未完成。

## 可指导实现的边界

输入投递必须有原 task／binding／run／generation、私有发送所有权、原 native session 和 input UUID。SDK yield 是本地交接，不能自身升级为原生接受。采用生命周期时先核验实际能力声明和支持的协议版本；保存 queued／started 各自证据，不能合并叫执行成功。当前孤立候选只白名单验证 2.1.321，不是对所有版本的兼容承诺。

有精确 UUID 的原生流事件也可证明开始响应；同样不是最终结果。多 UUID 字段和旧单 UUID 字段分别解析，不能假设只会回显最后一条。合并批次／steer／原生子 Agent 的实际语义还需专门验证，本批只有一条输入／一个主线程。

生产实现应将原始回执持久化后再推进接受状态，读取／确认不能覆盖其发送事实。真正未取得或尚未落库的证据保持 unknown；已有有效 queued／started 不能被忽略后统一丢进 unknown。初始化／requesting 回声本批只记录观察，不把所有带 UUID 的 system 消息自动算完成。

候选 acceptLifecycle 入口仅由持有原私有句柄的适配器调用，init／frame 是驱动收集的真实原生帧；最终应接原 Query 事件入口和持久 inbox，不能暴露成 renderer 可任意提交 JSON 的授权接口。current owner 已停止后迟到回执、宿主崩溃、丢包、完整业务 MCP 和 UI 仍未在本批验证。

## T3 对照

本地 ClaudeAdapterV2 的 claudeEchoedPromptUuids 先取 user_message_uuids 再回退单值；handleSdkMessage 用输入回声释放暂存帧，同时独立处理 command_lifecycle。它还把 completed 且从未 started 判作无实际回合的失败，说明不能只按事件名字推断执行。此次是源码对照和 SDK 原生实跑，没有运行 T3 适配器测试。

## 证据

[结果](result.json)、[两次实验运行审计](runtime-audit.json)、[版本与源码依据](source-review.json)、[摘要](archive-manifest.json)、[原始驱动／协议／SQLite](raw-evidence.tar.gz)。187 个文件、9 份 SQLite 完整性／外键通过、504 个构建输入复核；SDK JS／声明和原生版本来源另附摘要。

复跑需要归档中指向的固定 SDK/native 和临时依赖，执行 node probe.mjs；只使用临时 HOME／localhost 和捕获的自有子进程。无付费模型、真实子任务或外部业务写入。
