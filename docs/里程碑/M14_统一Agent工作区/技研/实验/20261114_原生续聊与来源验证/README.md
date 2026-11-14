# 原生 A→B→A 续聊与输入来源验证

日期：2026-11-14。SmartDD `40ea344a930aec37e36a803b7c621d3632d2d75a`，T3 对照 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`。对应 Q05／Q15–17。

## 范围

实际 Codex 0.167.1 app-server → Claude SDK 0.3.321／native 2.1.321 → 原 Codex 线程。使用独立 HOME、本地假模型、非 Git 临时目录、合成文本，无真实模型／业务调用。第二次 Codex 是新进程，在原 CODEX_HOME 中 thread/resume 同一线程；不是只在同进程 unsubscribe／resume。

输入和交接条目由实验明确选择，不是 WillYou 已实现的规范历史存储／覆盖账。没有完整业务授权、附件或长上下文。

## 结果

attempt-1：S02–04 通过，S01 的“只有一个 result”断言失败。原始请求只有一次 B 模型调用；实际有两个 result：历史 UUID 的空 success／num_turns=0，当前用户 UUID 的 ANSWER_B1／num_turns=1。这个失败来自驱动错误地将所有 result 都当用户回合终态，不是两次模型请求。

attempt-2：按 UUID 分开核验两个回执后 S01–04 全部通过。两批原件均保留。另直接转译执行 SmartDD 原生证据解析器与 NativeUserInputs，S05–07 在两批原生记录上均通过。

| 用例 | 证明内容 |
| --- | --- |
| S01 | Claude 输入队列先 shouldQuery=false／isSynthetic=true／client_composed=true 的历史，再真实当前输入：一次模型请求、两份独立 UUID 的 result |
| S02 | Claude 原生 JSONL 当前用户记录单独保留原文，包括 CRLF；历史记录另有 UUID、isMeta=true 和非用户来源前缀 |
| S03 | 首个 Codex 进程退出后，新进程 resume 返回同一 native threadId |
| S04 | A2 请求仍含 A1 原生历史；B 增量注入一次，没有再次注入 A→B 的历史块 |
| S05 | 现有 Claude NativeEvidenceAdapter 排除真实 isMeta 历史记录，接受当前原文 |
| S06 | 现有 Codex 解析器排除真实 developer 交接记录，保留 A1／A2 用户原文 |
| S07 | 现有 NativeUserInputs 在合成受信 UI sender／run context／固定时钟夹具下，可匹配原文；历史拼接后的文本以及单独历史均不能匹配该原文 receipt |

S07 不生成真实产品 UI 或程序化授权，不证明邮件可发送。其 requireSender 是测试占位，context 是最小合成结构；执行的是原 matcher，不是完整 run registry／邮件授权引擎。测试前首次加载遗漏 NODE_PATH，因找不到 better-sqlite3 未执行断言；随后指定既有临时依赖路径，未替换业务模块。

每批 3 个 Agent 进程均退出码 0。Codex 临时 HOME 的 helper aliases 警告保留，shell／apply_patch 不在本实验范围。SDK 对假响应估算的 cost 字段不是实际费用，本实验未访问真实模型服务。

## 设计结论

T3 ProviderTurnStartService 的通用回退以 withInlineContext 合成当前 message.text。WillYou 已有 NativeUserInputs／NativeUserMessages 要求来源凭据与原文对应，不能不作适配地照搬。迁移必须区分：当前原文、历史附加、消息 UUID／原生 clientId、规范 itemId、投递凭据和业务意图。

固定版本下 Claude 可以将合成历史单独入原生记录而不调用模型，Codex 可以 thread/inject_items 注入 developer 历史；这给保留原文提供了可执行方案。共同接口宜报告“支持历史追加／回执类型／原文保持”，不把具体 SDK 字段塞进上层。历史空 result 仅是交接回执，不结束当前用户 turn，也不新增用户授权。

该方案仍需把历史与当前输入两次提交纳入同一可恢复宿主流程：历史确认后、用户发送前取消／崩溃，确认丢失、合并输入、排队追加、初始化 MCP、历史字节在原生记录的精确校验、旧 CLI 不支持字段等都未验证。不能假定 shouldQuery=false 没有任何回执或外部效果，也不能在能力不明的版本上先发送、再按结果猜是否支持。

如果执行器只能内联合成文本，需按明确包装合同核验发送载荷与原文片段，来源不可验证时只禁用依赖该来源的业务动作并给出原因，不伪造用户凭据。新增 programmatic-input 必须使用可信 UI／run／generation 身份与原生消息证据，不能调用旧 terminal observe 接口冒充真人输入。

## 复验与材料

根 probe.mjs 为修正后的驱动，attempt-1/probe.mjs 为原件；result.json 记录其哈希。build-native.mjs 转译实际源码及依赖图，仅将 Vite glob 展开为当前原始资源；native-build.json 记录输入文件哈希。转译产物、运行程序与 node_modules 不归档。

映射脚本内临时路径，准备两份依赖锁后运行 `node probe.mjs <新批次名>`（需回环监听）。运行 build-native.mjs 后，以临时依赖目录为 NODE_PATH 执行 `node verify-source.mjs <批次绝对路径>`。不得指向日常 HOME／数据库。

原始请求／协议与原生记录 gzip 保存，解压后哈希见 raw-log-hashes.json；它们仅含合成任务数据和运行时自己的提示词，不含真实 API key。证据整体哈希见 SHA256SUMS.json。
