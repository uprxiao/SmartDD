# 公共协议与 Driver 调用合同验证

结论：**P1 合同的 25 项隔离检查通过**。形成 15 类命令、6 类查询、10 类内部 Driver 调用、能力声明和规范事件／请求的运行时 Schema。补齐创建与提交分离、冻结目标、输入来源、类型化回应、业务／原生审批路由以及未知投递规则。研究候选深层冻结缺陷经失败检查复现后修正。

这是规范与纯决策函数验证，没有实际 IPC、真实 sender、运行 owner、持久命令服务、SDK 调用或业务授权；第一收尾包和整体研究未关闭。接口形状通过不能作为运行权限证明。

## 依据与材料

SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7`，T3 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`；本轮只读 T3 `packages/provider-core/src/server/driver.ts`、`ProviderAdapter.ts` 与 `packages/contracts/src/providerRuntime.ts`，以及当前 SmartDD task controller／共享类型。文件哈希与本地 Zod 版本见归档 sources.json。

T3 分离 Driver 定义、ProviderInstance 的 continuationIdentity、SessionRuntime 的线程／回合／请求等方法。运行订阅与后台工作另有合同，injectHistory 明确不支持与调用失败不同。WillYou 复用分层原则，但保留自身 capability/run、业务审批与 Electron sender，不照搬 T3 的请求响应类型或 WebSocket 同步机制。

[实验归档](evidence.tar.gz)包含合同、脚本、失败及最终结果；[哈希清单](evidence-manifest.json)。`node probe.mjs` 依赖归档记录的本地 Zod 目录；不联网、不启动模型。参数 `maxBytes` 由宿主提供，本轮只用小型夹具证明 UTF-8 字节计数；历史页 200 上限也是候选协议限制，不是已测产品性能预算。

## 合同分层

| 层 | 输入与责任 |
| --- | --- |
| UI 命令 | task create/open/rename/archive/delete，draft save，input submit，selection preview/apply，request respond，run interrupt/close，background stop，delegation create/cancel。统一 protocol／commandId，参数严格拒绝额外字段 |
| 查询 | task snapshot/history/events，delegation status，driver/skill catalogue；requestId 与命令幂等 ID 分开。事件补拉带 databaseId 与闭合水位范围，分页 cursor 不代表访问许可 |
| 内部 Driver 调用 | open(new/resume)、startTurn、injectHistory、steer、respond、interrupt、closeRun、readHistory、inspectBackground、stopBackground。包含精确 scope、启动／当前能力指针、冻结目标及交付引用；业务回应不进入 Driver respond |
| Driver 定义／能力 | 无固定品牌枚举；SDK／程序／adapter 版本分开。12 类能力显式 supported/unsupported/unverified/unavailable；声明支持但缺实现方法时拒绝注册。方法存在仍不等于该版本能力已验证 |
| 规范事件／请求 | 任务级事件不虚构 run；运行事件核 scope；request、模型、工具、后台、usage 与消息状态分开。消息 ordinal 稳定，revision 用于更新；未知规范事件拒绝，原生未知可经适配器成为无权限含义的 diagnostic |

业务实际授权、命令持久化和进程运行都不在 Schema 内完成。`freezeSubmission` 是通过可信 UI 入口检查后使用的内部纯函数；它不核实 Electron sender，不可作为任何传输的独立 handler。`origin=ui-user` 由调用路径确定，不能由 Renderer、MCP、模型输出或 canonical event 反向签发。

## 25 项证据与已修正失败

- P01–09：拒绝客户端伪造 source、run、凭据及原生 ID；创建只保存初稿；引用只能提交宿主 token，仍须实际解析；选择／草稿修订失效拒绝；UI 后续变化不改冻结目标；摘要按规范 JSON，UTF-8 按字节计数。未测试持久去重或实际引用权限。
- P10–12：第三品牌夹具不需改 Schema；缺能力不视为支持；unavailable／unverified／unsupported 区分；只有明确不支持注入且有已声明内联能力才选择内联。unknown 保持未知，not-sent 也需要明确的新尝试。
- P13–18：按 requestId、scope、revision 和冻结选项回应；请求所属 source 决定 runtime／business 路由。多选问题、数字范围、枚举／多选表单、拒绝／取消及 URL 原生完成分别处理；不识别的原生字段约束必须转 unsupported，不能剥离后提交默认答案。业务路线只返回“仍需业务服务验证”，不生成批准。
- P19–21：运行事件与请求不得串任务／代次；任务事件不带虚构 run；usage unavailable 不补零；未知规范事件和反向补拉范围拒绝。未运行真实事件存储、游标推进或 IPC。
- P22：首轮浅 Object.freeze 无法阻止修改嵌套 target/model 和 blocks/text，失败结果保留。改为对已解析、已分离的目标／内容递归冻结后通过。该修正只在研究 helper。
- P23–25：new 与 resume 的原生身份前置不同；序列化 PID 不当作 owner；Driver respond 只收原生回应；历史交接保留源 Task／条目修订、遗漏与摘要，不允许改成新用户来源。

## 落地与停止边界

P1 可作为现行设计的接口形状基线，C1.1 作为关系基线；开发时由同一个命令服务执行校验、目标冻结、持久收据和事务事件，再由可信 Driver 实例执行副作用。不能把 P1 纯函数或可序列化 scope 直接接到 SDK／业务工具。命令与事件存储、原生回执和 C1.1 的联合仍需验证。

表单只声明本合同已表达的字段语义。更多 JSON Schema 约束、特殊权限、secret 保护存储、原生协议版本差异必须在适配器补齐或明确未支持；本轮不证明所有 MCP 表单等价，也未撤回既有业务保留要求。业务 reviewHash／displayReceipt 必须继续由原服务核验；secret 答案不写普通日志、规范事件或通用 command receipt，持久恢复采用受保护引用。

host token、launch receipt、scope、capability hash 的形状都不是授权。真实 sender／owned run、同任务排他、资源引用、配置修订、目录协调、证据文件及业务状态继续沿已确定服务执行。当前代码尚无 P1 TaskCommandService，研究不将这些后续接线默认为完成。
