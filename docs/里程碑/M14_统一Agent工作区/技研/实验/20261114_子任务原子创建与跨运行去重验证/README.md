# 子任务原子创建与跨运行去重验证

日期：2026-11-14。对应 M14-R05／R06／R08；Q19／Q24。**技术研究及临时数据库候选，无产品／原型修改，无原生 Agent、模型或业务调用。** 现有源码参考 SmartDD 40ea344a930aec37e36a803b7c621d3632d2d75a；T3 版本及文件见[源码对照](t3-reference.json)。

## 结果与复用范围

最终 attempt-1HiuRa 十项通过，包括两个真实 Node worker 同时提交及三个捕获宿主 PID 的 SIGKILL 窗口。证据见[结果](result.json)、[原始归档](raw-evidence.tar.gz)、[摘要](evidence-manifest.json)和[数据库审计](audit.json)。执行实际 32 份迁移、TaskService、AiProfileService／ProjectService／SecretsStore、runFixture 与 CapabilityRunRegistry；SQLite 采用现有 tasks／capability_runs 表，另建独立候选绑定、turn、委派、收据和 outbox 表。

PTY 注入 FakePtys，SecretsStore 使用合成 cipher；FixtureProcessReader 模拟父运行身份，不声称内核证明。打包时只替换 Vite raw-glob，以及将顺带加载的 node-pty 依赖改为一旦调用就抛错的替身；实际 TaskService 经注入的 FakePtys 执行。候选事务没有使用旧 TaskService.create 启动子任务。[构建记录](build.json)保存 479 个输入文件摘要及这些边界。

## 检查矩阵

| 检查 | 限定证据 |
| --- | --- |
| T01 | 实际旧 TaskService 在 fake PTY.spawn 时任务行尚未创建；CLI 启动失败不保存任务。相同 launchToken 在第一次 create 完成后再次提交，会创建第二个任务；它是创建取消／在途标记，不是持久幂等号 |
| T02 | 候选事务一次写实际 tasks 行、planned binding、queued turn、delegation、receipt 和 outbox。重复请求返回同一收据，异内容同键拒绝；native ID／lastLaunchedAt 仍为空，没有启动或能力投影 |
| T03 | 两个真实 worker 使用两个 SQLite 连接，同时发相同请求，返回相同 child／binding／turn／effect ID，数据库只有一组记录 |
| T04，三个窗口 | 插入 tasks 后、写完 outbox／receipt 但提交前、提交后分别 SIGKILL worker；前两者整体回滚，重试创建一组；第三个窗口保留整组，重试返回原 child。全部外键及完整性通过 |
| T05 | 接受后从实际 ai_profiles 表删除目标：旧 tasks.ai_profile_id 按原 FK 变 NULL，但候选计划保留原目标 ID。派发被阻塞，不换默认配置；已有收据仍指向原子任务 |
| T06 | 父运行撤销后，数据库 scope gate 拒绝；数据库仍显示 open 时，实际 RunRegistry 的当前政策回调撤销也在读取旧收据前拒绝。收据不授予新的调用权限 |
| T07 | 目录仍由父持有时只返回 waiting_parent_release；释放后领取带 token 的派发权，旧 token 不能越过新领取者。仅 claimed 且有未 fork 证据时回 queued；进入 dispatching 后即使调用方声称未 fork 也保留 unknown，不自动重发。ownerStopped／目录状态为本项夹具声明，未验证实际 OS fork |
| T08 | 实际 RunRegistry 停旧 run、建新 run（进程 reader 为夹具），将生成的行同步到候选副本库。相同逻辑请求在新 run 下仍返回原 child，origin_run 保留旧 run，当前调用权使用新 run；不借旧 run 授权 |

并发与崩溃 worker 使用冻结的已建立父 scope及数据库状态检查，不持有原宿主的内存 run handle；这些检查证明事务持久性，不代表跨宿主授权已完成。T08 的候选库接收实际生成的第二 run 行，也不是同一生产服务已连通。子 binding 只是 planned 记录，没有新能力快照、资源闭包、投影或原生执行。

## 发现的设计问题与修正

attempt-xpkAz7 在 T08 失败：先前候选及 T0.1 将 receipt 键绑定 parent_run，父重启后以新 run 提交同一个 clientRequestId，生成了第二个 child。保留了失败数据库与原候选，不把它当产品缺陷修复。

候选改为逻辑父 task＋稳定请求号唯一（本实验只有 delegate 一种操作）；origin_run 独立记录最初调用来源，当前运行仍重新过授权。最终十项通过。正式合同须加操作名／环境作用域，并由接入层持久保存逻辑请求与原生调用的映射；不能只依赖模型重新生成相同 UUID。若原请求身份已经丢失，先对账，不通过比较提示词猜去重，更不能悄悄换新键重发。

先前 attempt-aHsujw／G8WJ9u 的九项没有覆盖跨 run，不能凭当时通过声称重启去重已完成。aHsujw 的 IPC 没有保持引用，出现顶层 await 告警；虽记录的退出信号为 SIGKILL，仍补保持 IPC 引用后重跑。attempt-sYwuak 在 T01 后因合成进程起始身份格式非法停止，修为实际 reader 接受的格式后继续。首次语法检查和 node-pty 打包加载失败也保留原脚本；这些是实验准备问题，不是产品实现失败。

## T3 对照与迁移决定

T3 Orchestrator.dispatchDelegatedTaskRequest 在同一命令中生成 child thread、subagent、node／turn item 和子消息事件；ID 由命令分配。EventSink.commitCommand 把命令收据、事件、投影及 effect outbox 放在同一 SQL 事务，提交后才通知 worker／订阅者。本批只读核对，不运行 T3 故障测试，也不声称 T3 与候选使用同一种去重键。

WillYou 应借鉴提交边界，保留自身 SQLite／资源所有权体系：逻辑任务先入库，资源准备和原生启动由持久待执行项驱动。旧 TaskService.create 的先 spawn 后 insert 仍服务旧 CLI 入口，不能包装它后再单独补 delegation／receipt。新任务投影必须能表达 queued／blocked／unknown，不能用旧 ptyId 或 nativeSessionId 是否为空猜进度。

## 尚未证明

候选 profile_revision 只使用现有 updated_at，不是最终配置／凭据／能力的完整兼容身份；binding／turn 的复合作用域、完整 Schema、数据迁移及业务授权仍待定稿。目标删除通过实际表的 FK 验证，不代表整个配置删除服务或项目删除／归档竞争已适配。目录占用和未 fork 证明在 T07 是夹具，不能据此开放真实并发。

本批不证明进程启动恰好一次、跨 OS 副作用事务、两端实际 MCP 重试时保留逻辑请求号、正式 outbox worker／native 协议接线或完整 UI。已跨越 fork 窗口仍需真实 owner、scope 与派发回执对账。前批真实执行器证据与本批事务证据不能相加成同一条完整集成链。

后续 54 条产品用例仍全部未执行；本阶段只以这些证据修订设计，不开始产品验收或正式开发。
