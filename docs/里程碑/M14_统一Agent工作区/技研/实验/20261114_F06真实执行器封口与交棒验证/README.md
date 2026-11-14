# F06 真实执行器封口、范围声明与交棒

2026-11-14。**F06 研究关闭；未修改产品代码。** 本批补上一批所缺的真实 native 正常交棒、在途成员观察封口及共同结构映射。范围为首批 macOS arm64、Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1。不是所有平台的产品支持声明。

## 结果与证据

| 检查 | 实际结果 |
| --- | --- |
| N01 Claude | 真实 SDK 启动后台 Bash 写者。T3 原进程表解析／后代遍历函数找到它；暂停观察提交，closing 等待，拒绝新观察与旧业务 callback。迟到的三名成员登记后，root 尚活不能 seal；关闭 Query、真实成员退出后，同库 finisher 及目录权释放 |
| N02 Codex | 同一实际 owner fixture／SQLite／工作目录，Claude 未释放时 queued，释放后实际 app-server 启动并写入；原生 turn 完成时后台仍在。按 thread/closed 和进程退出收口，再封口、释放；没有把 unsubscribe ACK 当结束 |
| N03 观察失败 | 注入 ps 读取失败；真实测试根退出后，scope unknown、run stopping、下一写者 queued，资源／目录仍保留。故意保留恢复数据，不伪造空集合成功 |
| E01 | C1.2 数据副本安装执行范围扩展，在 DDL 后抛错；DDL 与 marker 整体回滚 |
| E02 | 同一扩展生成 C1.3；安装幂等，dangling run 外键拒绝，scopeRequired 与初始 scope 同事务成功／回滚；旧运行默认 0 不冒充新范围证据 |
| E03 | C1.3 结构漂移拒绝；原逻辑 submission／input／receipt／delivery 保持，SQLite 完整性与外键通过 |

[运行结果](result.json)来自 attempt-m62oi2；[结构结果](schema-result.json)来自 schema-Rn3kha。最终运行批四次本机合成模型请求，三个直接捕获的根进程及已收集成员均已确认结束；[清场记录](cleanup.json)记录根身份。没有外部模型调用或真实业务写。新的 .svn 只是工作副本范围标记；真实 SVN、双连接争抢、路径替换与宿主崩溃证据复用上一批及原专项，不宣称本批再做了一次。

当前实际运行注册器、资源库及 finisher 只在隔离 bundle 中加先前的共同 guard。异步启动门闩基于 T3 原 group wrapper，把同步 register 改为等待实际 attach；进程表解析／后代遍历用 esbuild 从原 TS 擦除类型，保留原算法。候选 collector 额外区分读取失败与空结果，记录精确出生身份，关闭时等待在途观察，终结前核验成员状态与当前修订；证明是私有对象，复制后不能释放。手动触发的观察覆盖封口交错，不冒充产品定时扫描器实现。

## 明确的范围边界

本期对标 T3 的默认等级为 **managed-observed（受管且已观察）**，不等于不可逃逸容器。覆盖本次拥有的 root、桥、原生控制记录和进程组／所跟踪后代；已知成员未停、身份／读取失败、已发现的范围逃逸都保持占用。known 表示这一已声明观察范围有有效证据，不能解释为整台机器不存在未知进程。

macOS 周期扫描可能漏过扫描间隙内脱离并重新托管的后代，通用 Shell／第三方 MCP／外部 IDE 也不因此得到全机器写隔离。不能宣称发现全部逃逸，更不能承诺任意外部写者间绝对互斥。需要强约束的环境必须另有已验证的系统容器／沙箱能力；本次不扩建它，也不把 Linux systemd 或 Windows 能力写成已验证。该边界承接用户确认的“先对标 T3 基座”，没有移除单／多 Agent、续聊或 SVN 默认串行功能。

原生子节点与宿主委派继续分开。已有原生子结果、定向停止及同文表单证据继续有效；固定版本不声明通用动态原生子树已完全排空。缺少该能力时提供整个宿主运行范围的停止／恢复路径，不伪造递归停止按钮。宿主委派的每个子任务仍有自己的 run、范围与授权，业务在途、独立 unknown 继续由 F08 收口。

## 首次失败与复验

attempt-TerI8J：观察超时；补传原观察错误后，attempt-mn7NZA 明确为研究驱动手工擦除 TS 遗漏 Set<number>，不是 native 生命周期失败。改用 esbuild 后，attempt-djmh2Y 的 Claude 已通过、Codex 超时；补 stderr／提前退出传播后，attempt-Pb7F9Q 确认缺少临时 CODEX_HOME 目录。补齐该必需目录后最终三项通过。全部首次结果／stderr／清场保留，不以重跑次数增加完成数。

## 复核与后续接线

[源码核验](source-verification.json)确认沿用的 379 个实际源码输入及 bundle 摘要未变。[归档](evidence.tar.gz)及[文件清单](archive-manifest.json)保存候选脚本、输入副本、失败／成功原记录；不包含真实凭据、用户数据库或 native 二进制。执行时需显式提供记录中的固定依赖／native 路径；仅归档核验不会重跑模型。

C1.3 是 C1.2 加[范围迁移](scope-extension.sql)，marker 与[最终结构](schema-manifest.json)有独立证据。运行探针仍通过当前 owner fixture 执行；关系探针用 stopped 历史 run 验证事务，不冒充同一完整新 TaskService。runId 外键接到共同运行身份，binding／generation／owner 及覆盖声明从不可变运行／启动计划关联，不能由 renderer 提供。生产 reserve 必须一次提交初始范围；探针 prepare 后建立 scope 只是隔离搭接点。正式 migration 注册、平台封装、UI 与同包回归仍按 A04／05／27／29／31／32／33 未执行，不以研究关闭替代产品通过。

F06 固定断言结合[前一批](../20261114_F06执行范围与共同释放验证/README.md)满足。Q04／05／29／31 研究关闭；Q27／32 的独立业务准入归 F08，Q33 的查询／I/O 归 F11，均不提前提升。
