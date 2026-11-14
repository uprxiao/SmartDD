# 当前程序化执行计划与私有业务 MCP 联合验证

2026-11-14；R02／03／08／10／12，Q04／09／27／28。技术方案 §9.4，验证账 §4.64。仅独立技术研究；生产与共享原型未修改。

## 本批补齐的链路

§4.18 的旧运行模型已接私有桥，§4.54 的当前程序化运行已接直接宿主业务检查。本批把当前候选的同一 task、多 binding、私有 owner、配置修订、ApplicationRunPlan／ExecutionPlan 和实际 native 接到现有私有桥：

`Claude SDK / Codex app-server → 原生启动 stdio MCP → 实际 bridge-runtime → 单次票据／Unix socket → 内核 peer 身份／祖先链 → PrivateApplicationBroker → CurrentApplicationAuthorization → ApplicationToolService → 合成只读 handler`

没有改用 dynamicTools 或直接 in-process MCP 绕过业务桥。桥的运行资源通过实际 RuntimeRegistry 发布；私有 bootstrap 和 stdio 参数仍由临时宿主组合，不能称最终 Driver／Electron 分发已实施。程序化 run／session 和资源保留继续使用之前的隔离源码变体，其余桥／权限／工具服务直接打包当前源码。

## attempt-OwyDun：3 项检查

| 检查 | 结论 |
| --- | --- |
| B01 Codex | 实际 app-server 原生发现私有 stdio 工具；内核 peer 与本 run 原生祖先匹配；合成 read 执行一次，结果进入下一模型请求；随后停用应用，第二次原生工具调用返回 APP_NOT_ENABLED，handler 未执行；冻结启动计划不变 |
| B02 Claude／切换 | 同一逻辑 task 的旧 Codex 排空后换 Claude binding；实际 SDK 原生启动新桥，重复正常调用／实时停用检查通过；旧 run 的工具入口 SCOPE_DENIED，新增桥 CANCELED，不借新 Provider 重新取得旧权 |
| B03 收口 | 两个实际 application_invocations 均 succeeded／attempt_count=1／read-only，分别属于两个 run、同一 task；无 running 调用，无重放，全部运行与桥结束后资源租约 released |

最终两次 native：Codex 退出 0、Claude 受控 close 退出 143；两份实际内核桥证明，六次本机模拟模型请求、两次合成只读执行。两个 native 回合分别取得 completed／success 终态；进程退出码不替代回合证据。被实时停用拒绝的第二次调用没有进入 handler，不应补造成功 invocation。

## 保留的初次失败

attempt-wU701K 的 Codex 检查通过，Claude 已初始化但未发送本轮模型输入；驱动断言旧 run 新增桥应返回 SCOPE_DENIED，实际 reserveBridge 按源码返回 CANCELED，导致检查停止。拒绝行为有效，仅把断言改为精确 CANCELED 后重跑，未放宽权限规则。初次三个模型请求、一份桥证明和全部清理记录保留；两批四个 native 均已退出，初次未启动桥记录 canceled。

## 设计结论与限制

通用 Driver 负责原生启动与 MCP 参数映射；现有业务权威仍留在私有 broker、真实 run 和实时策略服务。冻结启动材料不能冻结业务允许状态。Provider 切换后保留逻辑任务身份，创建新 run／桥凭据；旧 run 不因新运行存在而恢复。

身份由宿主所有权与内核 peer 证明，工具参数仅含业务输入；模型不能提供 runId／PID 来获得权限。业务结果和拒绝都经过真实原生 MCP 回包进入后续模型请求。停止顺序实际包含撤销 broker、关闭自有 native、监督桥退出、再收口运行与租约；只关 UI 或认为 SDK close 即等于全部资源释放不足以替代这些条件。

业务 handler 是合成 read，未调用真实禅道／浏览器／邮件／DB／SSH／外部插件；没有真实写入或产品 UI。没有接父子委派树、在途业务中断、宿主崩溃、完整历史交接、受管 native 二进制目录或跨平台发行。配置／私有桥联合可复用，但不能把它标成所有业务已兼容。

## 证据

[结果](result.json)、[运行及调用账](runtime-audit.json)、[构建／源码依据](source-review.json)、[摘要](archive-manifest.json)、[协议／内核证明／SQLite](raw-evidence.tar.gz)。189 个归档文件、7 份 SQLite 完整性和外键通过，712 个构建输入复核。

复跑需固定依赖与 native 路径；执行 build.mjs、build-bridge.mjs，再执行 probe.mjs。仅临时 HOME、SQLite、私有 Unix socket 和 localhost 模型，不触碰日常配置或真实业务。
