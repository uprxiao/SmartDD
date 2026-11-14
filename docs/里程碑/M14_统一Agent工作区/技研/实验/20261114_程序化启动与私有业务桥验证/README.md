# 程序化启动与私有业务桥联合验证

日期：2026-11-14。对应 Q04／Q09／Q27／Q32，设计见[技术方案 §3.3](../../技术方案.md#33-真实所有权)和 §3.4。固定 Claude SDK 0.3.321／native 2.1.321、Codex app-server 0.167.1，macOS arm64、Node 26.5.0。真实运行两端程序，模型回复和业务只读结果为本机夹具；没有生产源码、日常配置或真实业务／模型调用。

## 实际链路与替身边界

[build.mjs](build.mjs)只读打包当前 SmartDD 的 CapabilityRunRegistry、SessionRegistry、ResourceStore、PrivateApplicationBroker、AgentBridgeProcesses、ApplicationToolService、bridge-runtime 和内核身份读取器。桥服务通过真实 Unix socket、一次性票据、内核 peer PID／出生时间／可执行镜像／祖先链认证，不由模型或 renderer 提供 PID。每次使用独立 SQLite、HOME、配置根、应用包和原生进程。

现有 runFixture 提供合法受控 v2 会话及应用包。Claude 使用原夹具；Codex 仅在临时打包时把夹具中的 claude-code 和 .claude 改为 codex 和 .codex，使记录的 runner／adapter 一致。生产模块没有改写，Vite 的 raw glob 仅展开实际资源。业务 handler 是合成只读函数，经真实 ApplicationToolService 的选择、Schema、调用账和 withActivity；它不是浏览器、邮件、数据库或插件生产 handler，也未运行 CurrentApplicationAuthorization／ManagedTaskCapabilities 的完整生产组合。

桥运行程序由当前 bridge-runtime.ts 独立打包，真实启动为本次 Node；不代表 Electron／ASAR 发行资源已验。MCP server 依赖和打包输入摘要见 [sources.json](sources.json)及[build.json](build.json)。复用的身份 helper 和 C++ 源码摘要与此前[运行所有权实验](../20261114_运行所有权验证/README.md)一致。桥环境显式以 env -i 交付白名单；本轮不将其等同于生产环境过滤链。

启动候选参考 T3 的 FD 门闩、进程组和宿主 EOF watcher，但将放行改为等待实际异步 run.cli.attach 成功，捕获原始 ChildProcess 并登记退出。该候选只在探针中，不是声称原封不动调用了 T3 helper。两端都采用“一次 run 对应一个 app-server／SDK 原生进程”；没有验证共享 app-server 多线程拥有者，也未复用旧 CLI→独立 Codex backend 的双根组合。

## 运行结果

| 不同场景（两端各一项） | 证据 |
| --- | --- |
| 正常启动与私有工具调用 | shell 发出门闩已持有通知时 native 输出、模型请求、桥认证均为零；实际 attach 后才放行；内核证明桥为原进程后代；工具执行一次，调用账 succeeded，结果回到下一次模型请求；回合正常完成 |
| attach 出生身份不匹配 | 第二批向真实注册器传入错误预期出生时间，得到 RESOURCE_RECOVERY_REQUIRED；门闩未放行，无模型／桥／业务调用，原包装进程实际退出后释放 |
| attach 前取消 | 取消后候选拒绝登记／放行，无模型／桥／业务调用；只在自己的 ChildProcess 退出及未消费票据收回后释放 |
| 业务在途时停止 | Agent 与桥已退出，但只读 handler 被探针门闩保持未返回；实际 run 仍 stopping、租约 active、activity active。禁止再 list；放行原 handler 后结束调用账／activity，才进入 stopped 和 released |
| 桥认证在途时停止 | 内核 proof 已读取但尚未完成 attach 时停止，Agent 退出后桥仍 armed／无 PID，租约继续 active。释放 proof 后实际监督器核对原身份已停止、拒绝认证并完成桥退出，再释放；无工具或模型请求 |

最终 **10 项不同场景**。第一批 [attempt-1](attempt-1/result.json)八项通过；第二批 [attempt-2](attempt-2/result.json)增强真实错误出生身份、取消前检查、停止诊断并加入两项认证竞争，共八项通过。最终采用第一批两个正常场景＋第二批八项，其余重复不累计。

第一批 attach-rejected 是在调用注册器之前抛出的探针错误；第二批才是实际注册器拒绝错误出生时间。第一批取消后的候选仍尝试 attach，未放行且最终安全收尾，但第二批已在 attach 前检查取消，不能把第一批写成同一保护逻辑。原批次脚本和结果保持不变。

全部批次共 **16 个启动包装进程**，其中门闩放行 **8 次真实 native**，获得 **8 份实际桥 peer 证明**；其余 8 个包装进程在 native 执行前关闭，不能写成 16 次 native。全部捕获的 root 退出、注册进程记录终结，最终资源租约释放；[离线审计](audit.py)和[结果](audit-result.json)核对时序、scope、业务账及来源摘要。

### 停止不等于立即没有模型请求

两端 stop-in-flight 都观察到第二次模型 HTTP 请求在停止过程中到达。本机假端点的 active-run 检查返回 SCOPE_DENIED（以 HTTP 500 返回），没有让该请求产生新工具调用。第一批没有单独记录该异常；第二批补了明确 trace，并由离线审计核对 runAborted=true、只有一次业务调用和一次尝试。

这证明当前测试的业务权威撤销与资源等待有效，不证明原生网络立即静止，也不是生产模型网关已经具备此拦截。整个执行范围停止仍需等实际退出；如果将来只 interrupt 而保留进程，必须另外验证输入／原生唤醒／工具入口的禁止路径。不要把根进程退出码 0 当作停止前回合成功。

### 在途调用与结果语义

停止时合成 read handler 尚未返回，原调用账仍 running／read-only。它返回后，实际服务的政策复核把账记为 failed／SCOPE_DENIED、attempt_count=1，activity 才 finished；没有重新执行。该结果不能推广成外部写操作撤销成功或副作用回滚。真实写服务保留 operationId／effectState 和已有收据核对规则。

## 设计约束与尚未证明

1. 必须等待异步登记完成再让 native 启动；输入流门闩不足以约束初始化时的 MCP。取消／登记失败不能让门闩放行，退出回调须在异步登记之前接好。
2. 已读取或认证中的桥票据不能按“认证失败”直接当作未 fork。保留占用，待真实 peer 身份核验和退出；不能仅凭 socket 关闭释放。
3. stop 先撤销业务入口，进程／桥／业务 activity 各自结束后再释放。原生已结束而业务未结束是已实证的合法 stopping 状态，UI 应能表达这个状态。
4. 本轮复用的注册器仍使用 ptyId 作为内部启动身份；正式 launchId／legacyPtyId 拆分、task／binding／run 新模型和完整 launcher 尚未实现。
5. 本轮普通进程组可收尾受测 bridge，不涵盖逃逸后代、其他平台 scope、宿主崩溃恢复、强制只读或所有后台任务；此前 group-only 反例仍有效。
6. 未验证 nativeSession 绑定与浏览器／插件等生产服务的联合权限、programmatic-input 来源、真实首次确认、业务写审批、共享进程、多绑定及正式 UI。Q04／Q09／Q27／Q32 保持部分；产品验收仍 0／54。

复跑需在隔离目录调整 build.mjs／probe.mjs 的绝对依赖路径，先 `node build.mjs` 和 `node --check probe.mjs`，再 `node probe.mjs`；`--refine` 仅跳过已有正常场景，最后审计同时需要第一批证据。audit.py 的目录名按原现场编写，审计归档需映射 attempt-1／2 并解压日志。禁止连接日常 HOME、真实模型或业务配置。归档只保留合成协议、诊断、数据库结果摘录与脚本；未复制日常数据、秘密或整个夹具库。
