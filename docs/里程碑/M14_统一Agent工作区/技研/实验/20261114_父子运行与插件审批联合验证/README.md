# 父子运行、Provider 切换与现有插件审批联合验证

2026-11-14；R01／02／03／05／08／10／12，Q09／11／24–28／38／40／43。技术方案 §9.3，验证账 §4.59。仅研究，产品及共享原型未改。

## 路径与复用范围

沿用程序化 task／binding／run、原子委派接受、ExecutionPlan 和 gated launcher 候选；父 Claude 初始化，创建子 Codex 并初始化。父排空后切 Codex，子取消后以原 binding 的下一 generation 启动。调用实际 PluginHostService、PluginProjectPolicy、PluginWriteApprovals、ApplicationToolService、插件生命周期及 sandbox-exec 子进程。

合成插件只在自己的临时数据目录记录一次调用；不访问网络、公司数据或真实业务。请求由隔离宿主直接调用 ToolService，不是 SDK-origin 业务 MCP。原生只做初始化，零模型请求；插件能力无连接槽，未读取任何凭据。

临时统一审批入口接收 source／task／binding／run／generation，重验实际活跃 run 后在宿主内部解析原 pty_id，并调用原审批服务。它保留 reviewHash、displayReceiptId 和 operationId，不让客户端把 native approval 当插件批准。实验中的窗口身份是宿主私有 WeakMap 句柄；未执行 Electron IPC、真实窗口授权或 UI。现有内部 PTY 字段仍保留，不称为去 PTY 数据迁移已完成。

## attempt-ygCq5f：P01–P06

| 检查 | 已取得证据 |
| --- | --- |
| P01 | 原 present API 拒绝新任务作用域结构；临时 facade 能精确展示子 run 审批且展示对象不含 ptyId；父视图无此审批，未审阅的另一窗口及伪造窗口句柄不能批准 |
| P02 | 父 Claude 实际停止、切为 Codex 后，子 Codex 与原审批仍有效；新父 run 不能把子审批当自己的回应，伪造 task／run 组合拒绝 |
| P03 | 实际子取消使待审批调用 failed／not-started，审批 cancelled；同子 binding 的 generation 2 不能使用旧决定，不发生插件写入 |
| P04 | 原审批允许记录提交后、继续执行前撤销实际项目插件权限，原策略再次核验并阻止执行；审批可为 allowed，业务调用却为 failed／not-started |
| P05 | 新请求以原审阅凭据批准后，实际沙箱插件写一次；相同 requestId 返回原 ToolService 收据，插件执行不增加；旧审批不能再次批准 |
| P06 | 将来源替换成 native-runtime 被入口 Schema 拒绝；待确认时撤销实际项目插件权限，迟到 allow 拒绝，调用 not-started，已有成功结果不重复执行 |

最终四次原生退出：主动关闭 Claude code 143，三个 Codex code 0；全部运行 stopped、run 租约 released。插件有两个真实 PID：安装激活和一次业务调用，监督租约 closed，后续按 PID／出生身份核验均 stopped；另外两个未启动调用预留也 closed。四个业务调用中一个 succeeded／completed，三个 failed／not-started；只有一次临时插件写入。

首轮 attempt-goKhbM 在插件安装前失败：驱动未创建沙箱要求存在的 synthetic-keychain 目录，实际沙箱拒绝启动。只修正临时目录准备后重跑；失败安装按同包 hash 和时间定位到隔离数据库，状态 rolled-back、无 runtime lease，原失败保留。未修改或关闭沙箱策略。

## 设计结论

统一请求展示应通过来源适配接回现有业务权威服务，不能把所有“允许”都交给 Agent SDK 回调。子请求的决定归属于实际子 run，父 Provider 切换不会继承该批准；父停止与取消子树是不同命令，不能隐式相互替代。

迁移过渡可以由主进程从可信 run 解析旧内部 pty_id，让统一页面采用新作用域而旧审批语义继续工作。不能用 renderer 传来的 ptyId、当前聚焦任务或最新 run 猜测；最终字段改名／删除与旧 IPC 兼容仍单独迁移。业务审阅内容、显示回执、当前策略复验及调用结果账保持原服务所有。

特别保留“审批允许”和“操作完成”的区别。P04 确认 allowed 不代表已发送：允许之后的权限撤销仍可使调用 not-started；统一 UI 应同时读取审批决定与实际操作状态，不能把 allowed 画成写入成功。

T3 RuntimeRequestService 在执行回应时核对持久请求状态、live providerSessionId 和活跃会话，两个 adapter 使用各自当前 pending callback；这里只读对照，没有执行 T3 模块。WillYou 可借鉴实际连接身份与回调分离，业务审批仍走自身服务。

## 未覆盖

真实原生提问／审批回调及其迟到回应、父子问题转交、递归子树取消、进程后台未知范围、操作已发送后的取消、宿主崩溃、配置连接／插件版本变更、SDK 经私有 MCP 发起本链、真实窗口和 UI 未在本批通过。共享目录只用于初始化，不证明 SVN 并发写入策略。合成无连接插件通过也不等于全部既有插件兼容。

## 证据

[检查结果](result.json)、[运行／业务账／失败审计](runtime-audit.json)、[源码基线](source-review.json)、[哈希清单](archive-manifest.json)、[驱动、变体及数据库](raw-evidence.tar.gz)。168 个归档文件、8 份 SQLite 完整性／外键检查、547 个唯一构建输入复核。

复跑限定临时 HOME／工作区及合成插件，build.mjs、profile-build.mjs 后执行 probe.mjs；sandbox-exec 的目录边界保持原样，不将夹具窗口句柄替代产品 IPC 身份认证。
