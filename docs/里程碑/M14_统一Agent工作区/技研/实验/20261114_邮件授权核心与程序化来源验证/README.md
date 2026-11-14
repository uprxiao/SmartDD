# 邮件授权核心与程序化来源验证

日期：2026-11-14。对应 Q17／Q41／A41，服务重开与来源保留兼及 Q48。**没有发送邮件或执行真实业务写入**；本轮为来源证据与调用顺序实验，生产代码、共享原型未改。

## 实际与替身边界

实际运行未修改的 MailUserAuthorizations（present／confirm／tryNative／verify／revalidateNative）及资源协调器，补充运行 MailSendDataService.execute 的原顺序。来源使用前序真实 Claude 2.1.321／Codex 0.167.1 六条原生记录的独立副本、前序 identity-overlay NativeUserMessages 和候选 ProgrammaticInputs；文件／inode／摘要检查与 SQLite 来源记录是真实操作。

以下是明确替身：ApplicationExecutionContexts、可信 UI sender、策略／连接状态、原生 run／binding／generation、L3 声明与输入接受回执重放；数据服务的 engine、preflight 和 view。没有绕过上述替身后声称生产入口已通过。数据库仅 action sources 表使用实际 0019 DDL，父 intent／grant 表为最小夹具，不是全量迁移或真实 MailExecutionService grant。来源 token 与最终发送 grant 分别记录；所有外部发送次数为零。

## 最终三十二项检查

| 检查（前十项各跑 Claude／Codex） | 结果及含义 |
| --- | --- |
| M01 | 真实原生行＋独立 programmatic receipt 通过现有授权核心，重复同意图返回同来源 ID，仅一条来源记录；未伪造 ptyId。只证明该单条明确引用路径的运行时合同，不表示正式 TypeScript／Schema 已迁移 |
| M02 | 后续同文 agent-delegation 不变真人授权，旧 live 来源失效，审计记录保留 |
| M03 | 同一输入已 claim 后不能授权第二个发送意图 |
| M04 | 输入时连接摘要与新 review 的配置修订不同则拒绝；当前政策 hash 变化使已有来源失效。真实连接服务未运行 |
| M05 | 已签入测试上下文集合的另一任务／run 被实际授权服务拒绝；切 binding／generation 后原证据失效。未证明实际宿主如何签发子上下文 |
| M06–07 | 在真实文件读取结果暂扣期间取消或插入内部历史来源，迟到结果不新增来源记录 |
| M08 | 同字节新 inode 在 revalidateNative 被拒绝。active grant 表为测试构造，不是引擎生成 |
| M09–10 | 只重开授权服务不能把持久记录变回 live token；来源 JSON 被改后 verify 拒绝。不是整个 App 进程重启／原生恢复验收 |
| E 四分支×两端 | 实际 MailSendDataService.execute：正常依次授权／重核后才到 fake execute；内部来源不调用执行；异步 read 期间出现既有 executionId 后不重新授权或新增执行；重核前换 inode 不调用执行。fake engine 的计数不能证明实际 SMTP 恰好一次 |
| U 四项 | 显示回执绑定 senderFrame 对象与 reviewHash；正确一次确认成功，重复／错窗口／错修订／来源 run 已取消均拒绝。没有实际 Electron 窗口或展示内容验证 |

[最终结果](result.json)来自 attempt-Ib7aSH；它在第二批通过后补了逐例目录／原生副本 SHA 映射并复跑相同三十二项。前一批 attempt-f6AblC 的 24 项表面通过，其中 M05 子上下文未登记，实际只碰到测试上下文守卫；最终补为已登记上下文并断言实际服务的跨 run 拒绝，另增加八项 E 检查。三批原始脚本／数据库均保留，不把首批 M05 计为有效跨任务证据，见 [前置与修正](preflight.json)。

## 对设计的影响

现有业务规则可以继续由 MailUserAuthorizations／MailSendDataService 负责；SDK 适配层新增可信输入和原生关联，不能自己生成发送许可，也不能把 UI review／native proof／最终 grant 合为一个“已批准”字段。

程序化输入类型必须正式区分 legacy PTY 与 task／binding／run／generation，现有 contextLive 的 ptyId 比较要随来源类型适配。此次单条引用路径的成功依赖候选 ledger 的完整 scope 校验，不允许因两边 ptyId 都缺省而略过身份比较。多条原话上下文、字面附件、供应商源格式和身份层完整集成仍待验。

必须保留异步来源读取后的 contexts.require 和重新 get intent，以及执行前 revalidateNative。同步 verify 检查的是内存 live 状态与 SQLite 审计一致性，不代替文件复核。UI 确认也不能从新 Provider 偷换原 intent 所属 run；旧 run 结束后原 token 失效，切换不会迁移授权。保持原发送意图／未知结果可查看，新的执行需沿现有明确授权／恢复流程。

原生主体来源、连接／政策、具体冻结内容、一次 claim 和真实业务授权是连续但独立的关卡。T3 的通用 Agent 适配／委派机制只作为架构参考，不声称其提供 SmartDD 的邮件业务规则；插件与浏览器仍需各自服务验证。

## 尚未完成

真实 ApplicationExecutionContexts／BuiltinPackageRegistry／连接预检、SecretsStore、当前完整包与运行 owner／私有桥联合、SDK 实时输入、Electron 显示与 sender、实际授权事务／SMTP、插件审批和浏览器权限。前序 native／owner 实验与本轮记录回放不是同一次端到端证据，不能相加成链路通过。Q41 记部分，正式 A41 未执行，产品验收保持 0／54。

[构建来源](build.json)、[源码与原生记录哈希](sources.json)、[原始工件](raw-evidence.tar.gz)保存实际 bundle、三批 SQLite／证据／脚本、逐例原生副本以及复用的候选 ledger／overlay。可在独立目录复跑，依赖实际原生 better-sqlite3 与构建清单中的 esbuild／zod；不在日常数据根运行。包含合成授权证据，不含真实邮箱、Key 或发送产物。
