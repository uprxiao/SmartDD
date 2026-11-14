# 双配置隔离与认证／代理故障验证

日期：2026-11-14。对应 R02／R03／R08／R11，Q05／Q06／Q54；设计见[技术方案 §5.1](../../技术方案.md#51-配置来源与失败隔离)。仅运行固定 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1，使用本机假模型／407 代理、独立 HOME／配置根、合成凭据；没有真实模型账单、登录或修改生产代码。native 自报 cost/modelUsage 是模拟请求的估计值，不是实际账单或供应商身份。

## 实验方法

[probe.mjs](probe.mjs) 对每个执行器分别并发 A／B 两套配置：独立模型名、合成 Key、URL 路径、HOME 和配置根。模型端点确认两个账号请求均已到达，才释放两份回复，避免将顺序运行误称并发。每次请求只记录 keyMatches、modelMatches、onlyOwnInput，不落认证头原文。

同一 HTTP 服务下用不同 URL 路径代表独立目标，两个配置不是不同外部厂商。Claude 用 settingSources=[] 及明确环境；Codex 用 model_provider／env_key 和参数覆盖。另放置指向本机“未选端点”的冲突默认配置，最后核对无请求且指定配置文件未被改写。Claude spawn 回调直接使用本次构造的完整 env；没有把 SDK 回传 env 或宿主环境整体带给 native。它验证明确交付条件下的隔离，不代表当前 WillYou 配置解析器已接线，也不证明 SDK 默认合并环境会自动满足此合同。

401 分支中 A 返回认证失败，B 仍正常；代理分支中 HTTP／HTTPS／ALL_PROXY 指向本机 407 代理、NO_PROXY 为空，核对原生确实经过代理且目标端点未收到请求。该结果限本机 HTTP／固定版本／本次观察及取消窗口；没有验证 HTTPS CONNECT／TLS、OAuth、Keychain、系统代理或真实 Clash Verge。

## 批次和纠正

| 批次 | 实际结果 |
| --- | --- |
| [attempt-1](attempt-1/result.json) | Claude 双账号并发通过；401 分支未获得终态，45 秒观测上限后关闭。原生发送 error_status=401、authentication_failed 的 api_retry 并重试，max_retries=10；没有把超时算作认证错误终态 |
| [attempt-2](attempt-2/result.json) | 尝试在 api_retry 后 interrupt，仍未取得有效取消终态。探针 prompt 生成器已结束；该批没有完整记录 interrupt 的 rejection 内容，因此不单凭它认定 SDK 缺陷或确定内部原因 |
| [attempt-3](attempt-3/result.json) | 将输入流保持到匹配用户 UUID 的 result，再关闭；同一认证分支取得 api_retry→宿主 interrupt→匹配 cancelled 生命周期／error_during_execution，B 正常。其余 Codex 并发／401、两端代理拒绝、默认配置保护共 6 项满足预期；不重复已通过的 Claude 正常并发 |

最终证据由第一批的 1 项及第三批的 6 项组成，共 **7 项不同检查**，不能写成第三批 7 项全过。两次失败的脚本／结果原样保留。最终覆盖 10 个原生实例／独立历史；所有批次共 14 个 native 都已关闭，前两批关闭故障实例为退出 143，最后 Claude 认证中断／代理错误为退出 1，其余为 0。退出 1 不单独用来区分原因。

## 已验证结果

| 检查 | 已有证据 |
| --- | --- |
| Claude／Codex 双账号并发 | 各自端点、Key、模型、输入匹配；真实请求门闩确认重叠；native ID 不同 |
| Claude 401 与 B 并发 | A 的 401 重试只到 A；显式 interrupt 后关联原输入终态；B 正常完成。没有等待全部原生重试耗尽，不证明其自然结束策略 |
| Codex 401 与 B 并发 | A turn=failed，B=completed；request_max_retries／stream_max_retries 在本轮配置为 0，不推广为默认重试行为 |
| Claude／Codex 407 | 实际代理收到请求；目标模型服务请求为 0，无观察到直连绕过；两端收到错误终态 |
| 配置来源保护 | 第三批 13 份指定 settings/config/auth 文件摘要未变，未选端点无请求；不是全部原生状态目录不变，native 历史会正常写入 |
| 离线关联审计 | [audit.mjs](audit.mjs)／[结果](audit-result.json)核对 10 份 native 历史都位于各自配置根且只含对应输入；核对最终三个并发门闩与错误归一化，不新增模型请求 |

### 终态不能按单字段猜测

真实 Claude 407 返回 `subtype=success`，同时 `is_error=true`、`api_error_status=407`、`terminal_reason=api_error`，进程退出 1。还出现同 command_uuid 的 cancelled 生命周期，但宿主没有请求取消。已有[候选 normalizer](normalizer-reference/adapters.mjs)把该 result 判为 failed；离线回放确认 401 api_retry 不产生 turn.terminal。

因此 subtype 不是单独的成功判据；cancelled 生命周期也不是“用户取消”的充分证据。需分别保存请求关联、原生错误原因、宿主取消意图／回执和实际终态。Claude 401 在第三批是“认证错误后由宿主取消”，不能宣称原生自然产生最终 authentication_failed 回合。输入通道提前关闭的失败也不能据此误写成目标配置失败。

## 源码对照与边界

- SmartDD AiProfileService.resolve 已拒绝缺失所选秘密值，TaskService 去除父 Agent 变量、按原 runner 保留显式／隐式配置根；SDK 迁移不能绕开这些规则。它们本轮只读核对，没有运行生产 resolve／SecretsStore。
- T3 ClaudeHome 合并环境时清理父 Claude 会话／消息变量和 ELECTRON_RUN_AS_NODE；自定义配置根使用 CLAUDE_CONFIG_DIR，避免改 HOME 隐藏 Keychain 登录。实验隔离 HOME 是测试条件，不是生产登录迁移方案。
- T3 ClaudeProvider／CodexProvider 同时看端点与认证来源，不能仅凭 token 变量名或 native 的 firstParty 标签推定供应商。来源源码 hash、版本及 gzip 原文 hash 见 [sources.json](sources.json)。

仍待验证：真实配置服务／秘密修订和 fork 之间的竞争、空 Key／缺来源分支、已有登录和显式／隐式默认根、真实供应商协议、完整代理／TLS、配置切换／恢复及产品错误 UI。Q05／Q06／Q54 保持部分；正式产品验收为 0／54。

重跑必须使用独立目录及 fake credentials，按本地路径调整脚本里的 deps；`node --check probe.mjs` 后，在允许本机回环监听的环境运行 `node probe.mjs`。`--continue-after-healthy-claude` 仅用于已有第一批证据时跳过该已通过项。audit.mjs 路径明确指向所审计批次；禁止将脚本连接日常 HOME 或真实模型端点。原始配置／auth 文件和依赖不归档入库；仅本轮选定的 10 份合成输入 native 历史压缩归档在 native-records，路径映射见 audit-result.json，未读取日常历史。
