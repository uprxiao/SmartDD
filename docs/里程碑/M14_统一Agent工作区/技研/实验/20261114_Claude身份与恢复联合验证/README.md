# Claude 身份建立与原生恢复：隔离技术验证

2026-11-14；对应 R02／03／04／08／10／12，Q02／13／14／17／48。技术方案 §2.3／§3.2.9，验证账 §4.48。仅技术研究；未修改产品／原型，没有产品验收。

## 路径与结论

使用实际 Claude Agent SDK 0.3.321、其 native 2.1.321，与上一批相同的程序化 run／能力来源／ExecutionPlan／资源交付候选，接实际所有权与私有句柄。只运行一个逻辑任务的 Claude 绑定，未加入父子委派、业务 MCP 或跨 Provider 切换。工具集合为空；模型 API 仅指向 127.0.0.1 临时服务器，由本机返回固定文本，不使用用户凭据或真实供应商。

SDK 初始化响应与 `system/init` 原生会话事件分开观察。两种成功模式在初始化返回时均尚无 init 事件或模型请求；随后第一条隔离输入触发真实 init，通过持有该 run 的适配器核对 cwd／版本／身份并绑定。不可变应用计划、ExecutionPlan、delivery 没有被首次 ID 修订重写，原发布收据可重试。此时间顺序是本版本实验观察，不承诺其他版本必然如此。

结束第一进程后，generation 2 的新 owned run 以 resume 恢复同 ID。第二次真正到达模拟接口的请求同时包含第一条输入、第一条回复和第二条输入，因而证明原生加载了持久历史；不是让模型回答“记得”作为证据。原生历史文件复制留证后暂时移开，第三运行恢复明确报 No conversation found，无 init 身份替换、无新模型请求；清理后原文件恢复且 hash 一致。

## 两种身份分配方式

| 运行 | 分配方式与结果 |
| --- | --- |
| attempt-4EqPhE | 不传 sessionId，由 Claude 产生 ID；H01–H04 通过 |
| attempt-IDYn4o | 宿主先生成 UUID，经 SDK sessionId 传入；真实 init 确认同 ID，H01–H04 通过 |

后者对应 T3 本地实现：`ClaudeAdapterV2.ensureThread` 调用 queryRunner.allocateSessionId（UUID）；运行选项在首次打开使用 sessionId、继续使用 resume。Codex 的 ensureThread 则真正调用 thread/start；因此上层不能统一把 ensureThread 返回或“手里已有 ID”当成原生执行／历史持久化成功。

T3 Claude 的 resumeThread 区分现存 live query 与磁盘 transcript：明确 empty 报错、conversation 标记为已打开以走 resume，读取失败交给 CLI 判断。此源码参考不意味着 T3 对所有损坏／缺失场景都有已执行证据；本批实际验证的是独立 SDK 的既有历史恢复与文件缺失失败。

H01 记录初始化与零请求；H02 记录真实身份及计划不变；H03 记录同 ID 新运行与实际请求历史；H04 记录缺失历史无替换／无模型请求。预分配 ID 在本探针中是适配器参数，不是已经实现了生产持久分配事务；最终 launch Schema 对预分配值和运行来源的绑定仍需在完整合同中实现／核验。

## 失败与清理

第一次启动在本机端口监听时遭沙箱 EPERM，尚未建立 fixture 或启动 native；保留冻结驱动与 preflight-error。允许隔离 loopback 后，attempt-OExKBZ 的 H01／H02 通过，H03 已完成真实恢复及历史检查，但探针误从不含 generation 的公开记录读取字段，得到 undefined。改为按 runId 查询实际行后两模式通过；这是驱动读取错误，不是产品或 SDK 缺陷。

三次实际运行共八个原生进程均有终态退出回执：正常研究停止的进程为 code 143，两个缺失历史反例为 code 1；不称全部“正常成功退出”。六次模型请求均为本机固定响应，真实供应商调用为零。临时 HTTP 服务关闭，移开的历史文件恢复。没有通过名称搜索或终止其他进程。

## 适用边界与证据

此批覆盖两种身份建立、正常新运行恢复及历史缺失。没有完整 App／操作系统重启、原生已接受输入后的失联恢复、业务权限／Skill／MCP 联合、并行委派、外部供应商认证或跨平台证明。init／result 的 session_id 只在归属与来源核对后关联，不能单凭错误 result 中带 ID 就认作成功身份或输入已执行。H04 错误 result 保留原 session_id，但没有建立可用会话。

[结果](result.json)、[驱动修正](driver-correction.json)、[进程及版本审计](runtime-audit.json)、[源码依据](source-review.json)、[文件哈希](archive-manifest.json)、[全部原始证据](raw-evidence.tar.gz)。归档 251 个文件、14 份 SQLite；完整性／外键通过，构建输入按解析路径去重 503 个。

在新临时目录恢复匹配的依赖与源码，调整绝对路径，运行 build.mjs、profile-build.mjs、probe.mjs 和 probe.mjs --allocated；监听仅限 loopback，使用合成配置。每次按捕获 handle 观察与收尾，不因观察超时盲目再启动。历史文件移动仅针对本轮隔离副本，不能对用户原始会话套用故障注入。
