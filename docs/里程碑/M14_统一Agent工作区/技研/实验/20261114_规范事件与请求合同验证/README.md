# 规范事件与运行请求合同独立验证

日期：2026-11-14。关联 R01／R02／R08／R12，Q01／Q11／Q55；[现行技术方案](../../技术方案.md)的 §2.3／§4.4 为设计口径。本实验只实现临时候选契约，未修改 SmartDD／T3 业务源码，没有运行新 UI 或新的真实模型回合。

## 证据层级

- **录制的原生协议回放**：从既有 managed-a3 实验提取 Claude 首轮 21 帧、Codex 首轮 32 帧，均保留到首次终态；原始实验使用真实 SDK／native 和本机模型替身。来源路径及 hash 见[trace-sources.json](trace-sources.json)，本次没有重新调用模型。压缩帧见 [Claude](claude-frames.json.gz)、[Codex](codex-frames.json.gz)。
- **候选公共核心**：[contract.mjs](contract.mjs) 用 Zod 运行时校验规范事件／请求，统一 SQLite 事件／item／请求／回应收据；[adapters.mjs](adapters.mjs) 只在边界转换，第三执行器是明确标注的 `third-fixture`。该核心不是现有 TaskService、能力快照、业务桥或生产数据库迁移。
- **请求夹具与 native Schema**：批准、问题、表单和 URL 由明确的合成请求驱动，不冒充 live server request。另用 Codex 0.167.1 同一已验证 native、独立 HOME 生成含 experimental 的 Schema，见[生成记录](schema-generation.json)。[Schema 检查](native-schema.mjs)验证 29 条录制通知及 10 份请求／回应夹具；[结果](native-schema-result.json)区分两者。
- **不计产品验收**：第三夹具没有创建真实执行器进程，也没有实现 A→第三→A、主／子委派或业务授权。规范化核心可扩展的局部证据不能替代 Q01／R12 的完整范围，更不能算额外真实品牌支持。

源码基线、依赖与解压 hash 见[sources.json](sources.json)；整个证据目录有[manifest](manifest.json)。运行脚本：[probe.mjs](probe.mjs)。SQLite 位于临时 attempt 目录，未把日常库或二进制归档入仓库。

## 执行与失败保留

| 批次 | 范围与实际结果 | 处理 |
| --- | --- | --- |
| [attempt-1](attempt-1/result.json) | K01–30 通过 | 只覆盖第一批范围，不能据此宣布合同稳定 |
| [attempt-2](attempt-2/result.json) | K01–30 通过；K31–33 失败 | 发现同 Driver 实例串工具映射、外部 native session 未拒绝、恢复后回应收据仍 dispatching |
| [attempt-3](attempt-3/result.json) | K01–33 全部满足预期 | 实例独立创建 normalizer；在映射前核对原生 session／thread；恢复事务同时更新 request 与 response receipt |
| [attempt-4](attempt-4/result.json) | K01–34 全部满足预期 | 增加独立 review 数据，确保批准页能展示命令／cwd／工具目标，不因回调留在后端而丢失审阅内容；UI 回应不可篡改 review |

四个批次各保留当时脚本。最后的规范输出：[Claude](attempt-4/claude-normalized.json.gz)、[Codex](attempt-4/codex-normalized.json.gz)、[第三夹具](attempt-4/third-normalized.json.gz)。这些输出并未覆盖所有原生事件：未映射帧保留诊断；流式文本最终快照、MCP 工具及终态是本次实际映射范围。原生用户回显／工具结果没有被转成新的可信真人输入。

K33 是真实第二 SQLite 连接上的候选恢复处理，用显式 Promise 暂停 transport；不是杀进程后的崩溃恢复。生产恢复前仍须先证明旧 owner 已停止并取得恢复独占，不能并行启动恢复器。本实验恢复 API 没有实现这项所有权门槛。

## 检查覆盖

| 用例 | 断言与证据 |
| --- | --- |
| K01–03 | 两端录制消息／工具／终态和第三夹具进入同一个事件与 item 存储；第三夹具流式／最终状态更新同一 item；任务内序号连续 |
| K04–07 | 非法规范事件、未知规范关键类型、额外 SDK 回调字段被拒；重复／旧修订忽略，等修订冲突与终态倒退拒绝；不同 binding 相同原生 item 不碰撞；未关联出站输入的 Claude result 只成诊断 |
| K08 | supported、unsupported、unverified、unavailable 及缺声明分别处理；没有用缺历史注入的第三夹具假装做完续聊 |
| K09–10 | turnId 可为空，问题 isBlocking=false 保留；原生 RPC 数字 7／字符串 "7"／不同 callback namespace 分别定位 |
| K11–14 | 一次／会话／带策略参数的批准保持差异；humanCommand 不提供会话许可；Claude allow 保留原 updatedInput；伪造选项、全局 boolean、客户端直接填 native decision 不触发发送 |
| K15–16 | 问题 ID、选项说明、secret 和自由输入保留；缺题／多题／非法选项拒绝。合成秘密答案经回调发送，但不写普通事件／回应账明文；未验证产品日志、加密存储或真实秘密 UI |
| K17–20 | 表单 string／integer／boolean、required、范围和 Unicode 字符数校验；拒绝不携带 content；未实现的数组／嵌套及原生设备证明保持 unsupported 请求，不降成批准按钮 |
| K21–22 | URL 点击或 UI accept 不能伪造完成，须匹配的原生 elicitationId 完成信号；非 HTTP(S) URL 与重复语义 ID 拒绝。没有打开网页或完成登录 |
| K23–24 | task／binding／run／generation 错配、伪造运行对象及非签发 UI 对象拒绝；只是候选权威夹具，未执行 Electron sender 校验或实际 run-registry |
| K25–27 | 相同响应 commandId 去重、改内容拒绝；发送异常保留 unknown 不重发；明确 not-sent 后需新修订／新明确操作才再次发送 |
| K28–29 | detach 后原回调过期，新 generation 不可接答；真实 SQLite 关闭重开只保留历史，不由 native ID 重建 callback |
| K30–33 | 三种 Driver 共用回应服务；补充反例推动实例状态隔离、native 身份核对、request／receipt 一致恢复 |
| K34 | 审批原因与命令／cwd 分别保存；客户端不能借回应覆写审阅内容。实验 review 使用合成数据；实际业务脱敏、内容预算与显示回执仍须接线验证 |

本轮表单实现仅覆盖上述子集；不是将数组、多选、默认值、格式化字段、权限档位或设备验证从 M14 要求中排除。其完整原生／UI支持、明确能力边界仍须后续验证及评审。

## 原生 Schema 的独立发现

最初直接用 `ServerNotification.json` 验证所有帧失败；它没有 `rawResponseItem/completed` 和 `rawResponse/completed` 两种方法。用同 native 加 `--experimental` 重新生成仍一样，失败记录保存在[native-schema-attempt-2-failure.json.gz](native-schema-attempt-2-failure.json.gz)及当时的两份脚本。

这两种方法的**独立** Schema 已存在于 `v2/RawResponseItemCompletedNotification.json` 与 `v2/RawResponseCompletedNotification.json`，旧生成目录也有。T3 `packages/effect-codex-app-server/src/_generated/meta.gen.ts` 明确登记了它们。最终检查按两种独立 Schema 校验对应 params，其余按通知 union 校验，29 条通知均满足。不是“实验开关修复协议”或“native 数据非法”的证据；它证明只依赖单一总 union 会误报。Schema 校验脚本还修正过夹具变量拼写错误，不涉及产品行为。

AJV 使用 draft-07、非 strict 模式以容纳生成器格式；数字格式显式检查有限数及安全整数范围。通过不能证明 JSON 超大整数无损支持，也不能外推未来版本兼容。表单／URL／问题／策略回应的 10 份合成夹具均经对应生成 Schema 校验，但没有实际送给运行中的 Codex。

## T3 对照与待验

T3 的 Driver.create 说明不同配置／实例不共享可变状态；Instance 持有自己的 adapter。ProviderAdapterV2 区分原生请求、会话、工具、消息和终态，RuntimeRequest 明确 live／message／not_resumable，providerTurnId 可为空。WillYou 按已有 IPC 与业务服务采用这些职责，不直接搬其所有契约。

剩余：完整命令／事件 envelope 与快照 Schema、所有原生事件和请求形态、真实 live 双端批准／拒绝／MCP elicitation、同步／owner／资源／业务链组合、第三执行器真实公共任务切换与委派、UI 对应组件、支持矩阵。规范化数据不是授权；现有邮件／插件／浏览器审批仍由各自服务验证，SDK 回答成功不代表业务已获权。
