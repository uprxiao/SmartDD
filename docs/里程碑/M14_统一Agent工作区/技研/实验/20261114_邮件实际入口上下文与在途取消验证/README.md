# 邮件实际入口、上下文与在途取消验证

日期：2026-11-14。D04，关联 Q09／Q12／Q17／Q41／Q49。承接 §4.100 服务基线，这次将实际 ApplicationService、ApplicationExecutionContexts、MailSendDataService、MailUserAuthorizations、MailSenderIdentity、ToolService 和运行注册器放在同一隔离库中。最终 attempt-PhjrjA 八项通过。

## 边界与准备

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，构建 677 条输入摘要已复核。没有产品源码变更。实际连接测试只向本次持有的 127.0.0.1 SMTP 替身发一次认证；服务器拒绝 DATA，发送执行改用受控函数，三次受控 submit 不发送真实邮件。

当前源码的 retained-v1-test-fixture 定义、资源与适配器通过原构建脚本的临时副本生成。该副本只替换导入位置和测试 bridge hash；bridge 内容为立即抛错，禁止执行。实际 BuiltinPackageRegistry 验证并安装测试分发；不是默认 v2 分发／实际 MCP 传输证明。SecretCipher、renderer event／trust predicate、进程身份 reader 为夹具；run 状态变更、业务上下文、权限与凭据句柄、邮件准备／授权／执行逻辑均为当前实际实现。没有真实 Electron 页面、真人批准、原生 Agent 或模型请求。

## 八项检查

| 检查 | 实际结论 |
| --- | --- |
| E01 发件身份 | 未确认身份的 UI 准备在创建 intent 前拒绝；通过实际 projectAction 确认后继续，不能把选择 SMTP 等同于身份确认 |
| E02 不透明身份 | 克隆 context／actor 均拒绝；实际 withUi 返回后原 context／actor 也失效，持久 ID 或 JSON 不能代替当前宿主签发对象 |
| E03 UI 审阅 | 错 frame 拒绝，真实服务消费 display receipt，原 intent 只受控提交一次；重复执行返回同 execution，subject 关系由实际业务写入 |
| E04 Agent 入口 | 实际 ToolService 创建草稿／准备意图、UI 审阅授权；另一 run 执行被拒绝，原 run 执行一次。通用调用／Data API 同 operationId 与 run 关联，targets 固定实际 SMTP 来源 |
| E05 撤销后恢复 | 审阅后停用连接拒绝执行，再启用也不能恢复旧 grant，不改选其他账号 |
| E06 凭据句柄 | 连接管理主动使已固定上下文取消；旧句柄消费 CANCELED，第二次 SCOPE_DENIED，失败也消耗句柄，不返回 secret |
| E07 来源已退出 | 已显示的 Agent 意图在来源 run 退出后不能再授权，未生成 active grant 或发送 |
| E08 在途取消 | run 停止且受控 CLI 退出后运行账为 stopped，未返回的 submit 仍持独立 mail-send active 租约。实际服务排空后租约 released；外部结果继续 unknown，迟到成功不改写、不重发 |

E08 用 Promise 事件门闩观察进入／完成，不以睡眠判断状态。最终四个 run 全 stopped、47 份资源租约全 released，SQLite 完整性与外键通过。所有尝试均已核对运行停止、租约释放，回环服务器通过本次持有的 handle 关闭。

## 失败与修正

- 首次构建 CJS 的 import.meta.url 警告会影响 createRequire；在执行前用隔离 file URL 定义修正，保留初始构建脚本与摘要。
- attempt-xxoXkH 在 sandbox 监听 EPERM，零检查／零认证／零提交；通过工具批准执行同一回环实验后 attempt-afgCqj 五项通过。
- 扩展后的 attempt-Ctc88c 在 E06 失败：驱动预期 REVISION_CONFLICT，但实际管理入口先 contexts.invalidate，因此消费得到 CANCELED。核对 management／record／CredentialHandles 源码后修正精确预期，并新增第二次消费拒绝；没有放宽成“任意错误均通过”。旧失败保留。
- E08 的准备假设曾把邮件活动等同 run counter；源码显示 retainSendActivity 使用独立 ResourceStore.use，所以在执行该分支前改为直接核对 mail-send 租约与原结果。最终观测明确记录 run stopped／mail lease active，而非宣称 run 一直 stopping。

## 设计影响与未验项

统一层只提交任务、动作和审阅引用；实际运行与业务入口重新签发上下文，不从序列化 context、Agent 输出或父任务身份授予权限。发件身份预检、原 intent／run、display receipt、最终来源／凭据消费分别保留，不合并为 approved 布尔值。失效上下文的 CANCELED 是调用状态，不能据此判定外部副作用未发生。

运行、mail-send 等业务租约和结果账是三个事实来源。迁移／交接要按真实业务范围核对独立活动，不能把 run stopped 当成全部业务排空；未决结果对账和活动释放也不能混用。

仍待验证默认 v2 分发及当前程序化新入口／原生用户来源／私有 MCP 与上述服务的联合、跨对象最小限制、所有写入口协调与恢复；真实 UI、真实账号和安装包留在产品阶段。本轮不增加正式产品通过数。

复现：具备 build.mjs 固定依赖后执行构建；在 SmartDD cwd 运行归档的 build-fixture-bundles.mjs 生成私有测试分发，再执行 probe.mjs。回环监听需环境允许；不需要外部账号。见[结果](result.json)、[来源与替身清单](source-review.json)、[原始归档](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
