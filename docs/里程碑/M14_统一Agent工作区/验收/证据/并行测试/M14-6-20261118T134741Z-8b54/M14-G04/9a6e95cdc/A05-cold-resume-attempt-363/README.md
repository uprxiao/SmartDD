# A05 冷启动续聊：真实模型通过（第 363 次）

2026-11-19，Claude Code 接手执行。macOS arm64，隔离包 `9a6e95cdc`（`app.asar` `ca01a1cc…4fb14c9`，复用前核对了源码 HEAD、ASAR 和签名），Claude CLI 2.1.326，上游为 DeepSeek 官方 Anthropic 接口，只发送合成数据。

## 第 361 次的失败原因

原生会话记录里保存了每次请求的消息结构，按它重建了 361 发出的第一个请求。Claude CLI 每次请求都会在 messages 里带一条只有文本的 `role: system` 环境说明，第 357 次的每个请求里也有同一条（blob `1793b699…`）。冷启动驱动的合同只允许 user 和 assistant 两种角色，所以第一个请求在驱动这一层就被拒绝了（422）。CLI 收到 422 后去掉部分 beta 自动重试两次，这两次撞上“只放行一个请求”的守卫；中继只保留最后一次错误，第一次的真实原因被覆盖了。结论：**驱动判据错误，不是产品缺陷**。

## 驱动修正（新准备目录，Codex 原目录不动）

- 合同允许只含文本的 system 消息，带其他类型块的仍然拒绝。[反向对照](negative-control.mjs)：原合同拒绝含 system 消息的请求，修正后接受。
- 中继错误逐条记录在 `transportErrors`，不再覆盖第一次的错误。
- 前置基准改为 361 之后的实际状态：数据库 SHA `c9071a97…`，原生记录 SHA `e7e79e8d…`，代次 1–3 均已停止，6 个 CLI／桥进程均已退出（与 361 的清场记录一致），6 条输入中最后一条为失败。新一轮必须是代次 4。
- 合同测试 5/5 通过，其中一条用的是原生记录里真实的 system 消息；CDP 表达式和语法预检通过。

## 结果

- 从真实侧栏打开原任务：历史可见，任务空闲，启动时没有隐式重发（[截图](01-reopened-same-task.png)）。
- 在原输入框提交一条带随机标记的纯文本请求。中继只收到 1 个请求，错误列表为空。请求来自新的 CLI 进程（PID 30288），该进程用 `--resume` 加载原会话 ID `4512f5e5…`，是同一个绑定（`424058f0…`）的新代次 4；请求里带的两条历史回答取自原生会话记录，没有 WillYou 历史交接。
- DeepSeek 返回 200，答案为 `A05_FIRST_PERSISTED_ROUND_ANSWER | A05_SECOND_PERSISTED_ROUND_ANSWER`，与前两轮的原答案一致，没有工具调用；界面上显示同一段文字（[截图](02-cold-resumed-real-answer.png)）。
- 原生记录的原有部分逐字节保持不变，后面追加了这一轮。
- App（PID 30199）正常退出，退出码 0；新 CLI 和桥进程按出生身份核对已退出；3425 已释放。归档文件扫描过，没有密钥。

[原始结果](result.json) · 驱动：[主脚本](source-a05-cold-resume.mjs)、[合同](source-contract.mjs)、[合同测试](source-contract.test.mjs)、[前置核对](source-source-proof.mjs)
