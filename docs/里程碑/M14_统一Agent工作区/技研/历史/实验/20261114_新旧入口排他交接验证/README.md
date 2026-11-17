# 新旧入口排他交接：独立技术验证

范围：当前 SmartDD CapabilitySessionRegistry／CapabilityRunRegistry／运行恢复代码，真实自有 Node 子进程及 macOS 进程出生身份，旧候选 SQLite 映射和本轮最小交接门禁。五项检查通过。没有启动模型、PTY、SDK，也没有修改产品代码。

| 检查 | 实际证据 |
| --- | --- |
| E01 停止调用返回 | 实际 stop 返回 stopping；进程仍在、业务 Promise 未结束，候选迁移拒绝 |
| E02 子进程退出 | 收到真实 exit 0 后记录退出；业务活动尚未结束，run 仍 stopping，迁移仍拒绝 |
| E03 业务结果未知 | 活动完成后 run 停止、租约释放；显式注入一条合法 unknown 写记录。结构迁移成功，但新增入口门禁拒绝并保持 legacy |
| E04 身份冲突 | 新绑定不能抢已有旧会话；旧注册器创建与新绑定冲突的原生 ID 时由 SQL 守卫拒绝，整个旧创建事务回滚 |
| E05 排他交接 | 合成对账后，旧摘要拒绝；两个同时发起的门禁调用只成功一个；旧 reserve 被 SQL 守卫拒绝且没有新增 run／租约；历史快照仍可读 |

E03 是候选组合的反例：结构迁移只证明数据可映射，不证明可执行新任务。它不是当前产品已有 SDK 切换功能的缺陷。本轮 unknown 写由夹具注入，后续“对账为未开始”也是夹具，不代表真实外部系统结果可以自动确定。E05 仅将原 binding 的 entry_mode 封口为 programmatic，phase 仍为 historical；没有伪装成 prepared，也没有借已有“全新会话”发布接口导入旧原生 ID。

实现时复用原 binding、native ID、根目录及不可变历史；在同一资源锁和写事务中检查当前来源、未决运行／进程／业务与修订，写入交接状态并封住旧写入口。随后另行验证投影、执行配置及资源计划，再进入可启动状态。失败或宿主退出必须保留可读历史、交接阶段和可对账记录，不能靠解开旧 SQL 守卫、清空未知状态或新建原生 ID 恢复。程序化到兼容 CLI 也应通过统一 owner，不能让旧 TaskService 绕过它。

T3 参考 ProviderSessionManager.releaseEntry：区分活动、订阅排空、scope 关闭及持久释放记录，排空后补记迟到工具事件。WillYou 应借鉴这些分层，但还须检查自己独立的业务调用／邮件／浏览器等结果账；T3 的 session 关闭不能替 WillYou 证明外部写已完成。

证据边界：真实普通子进程；不是原生 Agent 或 PTY。并发是两个宿主调用竞争同一资源锁／事务，不是本轮跨宿主 SIGKILL。只执行 application_invocations 的未知写门禁反例；其他业务表、完整 adoption／准备／恢复、项目写者范围与真实 TaskService 尚待联合。Q49 仍为部分。无新产品通过项。

复跑：先在 SmartDD cwd 运行 build.mjs，再运行 probe.mjs。依赖位于既有隔离目录，源码、依赖输入、生成 bundle 与进程 helper 均记录摘要。初次构建将 glob 中目录作为文件读取导致 EISDIR；过滤目录后成功，实验首跑即五项通过。

[结果](result.json) · [运行审计](runtime-audit.json) · [源码依据](source-review.json) · [归档摘要](archive-manifest.json) · [原始脚本与 SQLite](raw-evidence.tar.gz)。
