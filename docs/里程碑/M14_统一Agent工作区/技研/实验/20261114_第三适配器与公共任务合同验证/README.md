# 第三适配器与公共任务合同验证

日期：2026-11-14。对应 Q01／Q14／Q19–20，并补 Q15–16 的候选公共接线。当前阶段仍为设计与隔离验证，未修改 SmartDD 产品实现。

## 验证层次

[host.mjs](host.mjs)是独立候选公共任务服务，使用真实 SQLite 保存候选状态，并复用前序规范事件／请求 Kernel。三个[协议夹具](fixtures.mjs)分别使用前序 Claude、Codex normalizer 与第三种消息格式；这些输入都是本轮合成帧，没有运行真实 SDK、模型或 CLI。第三种格式通过同一任务选择、历史交接、提交、委派及回父路径，公共 host 不按品牌分支。

它与前序只验证第三 normalizer 的实验不同，但仍不等于新 TaskService 已在 WillYou 实现。运行所有权是宿主内存对象身份；没有真实 PID、资源租约、SVN／Git 写入、业务桥、可信 UI、完整原生事件或跨进程服务。委派组合使用不同的逻辑 workspace 名称，不证明工作目录隔离。

## 十九项合同检查

| 检查范围 | 得到的证据 |
| --- | --- |
| 配置与目录 | 重复 Driver、未知配置版本／额外字段／未知 Driver 拒绝；禁用目标和缺失凭据引用拒绝；目录展示不含秘密引用。凭据解析是白名单夹具，非 SecretsStore |
| A→第三→A | task 保持、恢复原 A native ID、只交接缺少的规范条目；第三适配器使用明确声明的内联路径，来源保持 history-transfer |
| 模型与账号 | 同身份换模型复用绑定但旧配置令牌失效；同 Driver 的第二账号使用独立绑定，两个实例并发提交不串结果 |
| 九种主／子配对 | 三个 Driver 的全部有序配对走同一 delegate／collect；创建与回父幂等，子输入为 agent-delegation，回父为 agent-result |
| 能力差异 | 无宿主工具通道的适配器可聊天／做子任务，但不能主动委派；turns 的 unsupported／unverified／unavailable 分别拒绝；没有历史路径时不先关闭旧运行 |
| 不支持与未知 | 明确不支持 resume 时创建新原生绑定，保留旧绑定与 lineage、重新交接历史；暂不可用不冒充“不支持”。明确不支持注入才走内联，unknown 不回退、不重发；not-sent 单独保留 |
| 启动与选择 | CAS 失败、打开失败、配置在异步 create 期间改变、能力在 create 期间改变均有明确结果；旧运行已关后不谎称恢复旧运行 |
| 运行句柄与来源 | 旧／伪造句柄不能委派；同命令结果未知不再发送。入口与身份只在候选宿主内验证，不代替 Electron sender 或实际业务授权 |
| 可选请求能力 | 没有请求回应能力不应一并禁止普通聊天；真正打开请求时单独检查 |

[最终结果](result.json)为 attempt-wrpuAJ 的十九项通过。九种配对是其中一组检查，不计为九个真实品牌组合或产品用例通过。

## 反例与修正

前序 Kernel 在 attach 时强制 require(requests)。本轮负对照证明这会把没有审批／提问通道的聊天适配器一起禁用；仅在临时副本中把基础接入要求改为 turns，把 requests 检查移到打开请求。公共服务还按当前实例能力检查，不能只看 Driver 级声明。

attempt-6NveYU 在最后一项得到 Missing expected rejection：配置对象未变，能力已从支持变成不可用，候选只核配置修订仍接受新运行。临时候选增加独立能力快照摘要，在异步打开前后及调用前复核，最终批次通过。实际产品应结合资源／协议探测修订和租约，不能照搬 JSON hash 就宣称消除了所有外部竞态。

attempt-4dS2zi／HiaDRU 分别保留十五项／十八项的中间验证；后来增加恢复替代路径及能力竞态，不将旧通过数相加。失败、原始候选源码、SQLite 和调用轨迹均在 [attempts.tar.gz](attempts.tar.gz)，[成员摘要](attempts-manifest.json)可核对。审计确认候选运行对象均关闭，唯一无 close 的 create 是故意在对象生成前抛错的打开失败；这不是原生进程清理证明。

## T3 对照与迁移边界

本地 T3 driver.ts 明确 Driver.create 不共享不同实例的可变状态；ProviderInstance 有 continuationIdentity、orchestrationAdapter 与可选 auth。ProviderAdapterRegistry 在打开会话时检查同 credentialBinding 关联实例的凭据变更，并用 withAccess 包住打开流程。其 metadata 暴露实例、continuationKey、enabled 与能力。WillYou 可采用这些职责分界，继续使用现有 AiProfileService／SecretsStore／业务资源注册器，而不是创建另一份账号配置。

SmartDD 的 RunnerAdapterRegistry 已覆盖 CLI 程序发现、配置根、参数和原生记录，但这些方法本身不包含程序化 startTurn／事件／历史交接。新增 Driver／Instance 接口应组合现有职责，普通聊天、请求回应、历史交接和宿主工具通道按能力分别准入；目录查询后仍复核确切实例、配置／凭据及能力修订。

## 尚未证明

候选用整块 JSON 保存宿主状态，只验证对象关系及命令行为，不是正式数据库设计、迁移器、事务 outbox、崩溃恢复或并发跨进程调度。未知状态的人工核对与恢复入口、not-sent 的受控重试、新原生绑定发布的一致性、父忙唤醒、完整请求转交及取消仍需后续联合验证。没有验证动态第三方插件执行信任、真实第三品牌安装／授权、远端／进程内 owner、生产 TypeScript 合同或 UI。

本轮未覆盖的事务和生命周期不能由“公共服务十九项通过”代替。Q01／Q14／Q19–20 均保留部分，产品验收仍 0／54。复现需按前序规范事件实验准备临时 zod／better-sqlite3 与 normalizer 路径，运行 `node probe.mjs`；审计固定归档批次，重跑应更新 audit.py 的批次映射。摘要与源码基线见 [sources.json](sources.json)、[audit-result.json](audit-result.json)。
