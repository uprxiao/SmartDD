# 配置、宿主计划与两端初始化：联合技术验证

日期：2026-11-14。对应 R02／03／08／11，Q04／06／13／20；设计 §3.2.12，验证账 §4.43。仅隔离技术实验，未改产品或共享原型。

## 本次补齐的关联

前批分别验证的单调执行配置修订、宿主 ExecutionPlan／应用计划／delivery、owned run 和取消门禁，这次置于同一候选链：实际配置服务解析→提交强关联计划和准备引用→运行租约接管→arm→受控 wrapper→内核身份 attach→再次核配置／计划→释放原生程序→初始化→显式取消并观察同一 ChildProcess 退出。

组合过程中移除了旧候选仍使用的 updatedAt 活校验及单独 fixture epoch。基线 `baseline.mjs` 用前批原样候选复现：只改名称会在 live reader 中报 TARGET_CONFIGURATION_CHANGED，尽管旧 fixture epoch 不变。此为研究候选遗漏，不是生产缺陷。新 execution v2／delivery v3 统一以真实配置表触发的单调修订作为运行前置；binding 的旧 profile_revision 字段不再充当执行 freshness，最终绑定兼容身份仍需独立设计。没有实现旧实验格式升级。

## 结果

`attempt-l3uiaH` 的 J01–J09 全部通过，另保存旧候选更名误拒绝的负对照。共捕获五个子进程退出，其中四个真实原生初始化、一个仅 fork wrapper 后阻止 exec。未发送模型任务、未调用原生 thread/start、未调用业务工具。

| 项 | 已证明 |
| --- | --- |
| J01／J02 | Claude／Codex 两端：提交计划后实际服务更名并改 updatedAt，执行修订不变，原计划继续初始化成功；实际内核 PID／出生身份已登记，取消后核为 stopped |
| J03 | arm 后通过实际服务换 Key，旧计划在调用 native factory 前拒绝，未 fork；无需恢复配置即可清理 |
| J04 | Codex wrapper 已 fork、原生尚未 exec 时换 Key，attach 后复核拒绝放行，等 wrapper 实际退出；不冒充“从未 fork” |
| J05 | Claude 初始化后删除配置，旧计划不可再作为执行许可，仍可使用独立 owned 取消句柄结束原生进程 |
| J06 | Codex 初始化后换 Key，旧执行计划再取用拒绝，随后显式结束已启动进程；没有证明运行环境自动更新 |
| J07／J08 | 原生 spawn 回调试图换执行文件或冻结环境被拒绝，零 fork |
| J09 | 复制序列化 ExecutionPlan 句柄不能创建 launcher；配置删掉后的未启动任务仍可取消 |

## 版本、来源与边界

Claude SDK 0.3.321／native 2.1.321；Codex app-server 0.167.1；macOS arm64，程序与 SDK entry hash 在 runtime-audit。真实程序来自前批临时依赖目录，SDK 包资源完整安装／升级生命周期不是本批验证对象。独立 HOME／配置根、受控 PATH、仅指向不可用 loopback 的模型 URL／代理、合成凭据；没有用户登录配置或真实模型调用。

配置通过实际 AiProfileService／SecretsStore，密文加密器为假实现；单调修订为隔离 SQL 触发器。run 仍由旧 registry 的 legacy reserve 创建，随后夹具补 binding／cap／generation/source 关联；保留实际 v3 能力会话、v1 应用计划、真实 run 句柄／进程身份／资源租约。能力适配器及业务包仍为夹具，SDK 尚未接私有业务桥、当前业务权限和原生消息输入。

运行程序与冻结的配置环境由已核验 ExecutionPlan 提供，回调不能任意改换。宿主基础 env 是显式隔离夹具；外部 CLI 文件／系统代理／其他秘密源的完整来源指纹、真实 SDK 选项／用户参数映射和运行中后续 turn 仍未完成。程序文件校验到真正 exec 之间的替换窗口、其他宿主进程在最终检查后改配置、后台后代范围、崩溃恢复、首次真实 native thread ID 和完整 programmatic reserve 仍需验证。

初始化返回只证明握手成功，不是完整对话或单／多 Agent 功能完成。已有进程收到的旧环境不能因 revision 变化而撤回；J06 证明“后续旧许可拒绝＋显式结束”路径，不能宣称所有在途请求即时撤销。

## 证据与复跑

[结果及负对照](result.json)、[运行与版本审计](runtime-audit.json)、[源码依据](source-review.json)、[文件哈希](archive-manifest.json)、[原始驱动／候选／数据库](raw-evidence.tar.gz)。本批 114 个归档文件，10 份 SQLite 通过完整性／外键检查，503 个构建输入复核。

在临时目录恢复匹配依赖、原生程序及 process-identity helper 后，可运行 `node baseline.mjs`、`node probe.mjs`。归档 baseline-inputs 保存实际负对照输入；所有状态、数据库、追踪和程序 hash 均独立记录。不得把这些研究表或变体直接作为产品迁移。
