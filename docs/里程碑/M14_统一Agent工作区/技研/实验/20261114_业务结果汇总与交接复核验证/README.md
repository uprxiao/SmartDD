# 业务结果汇总与交接复核验证

日期：2026-11-14。D04，关联 Q09／Q37–42、Q49。目标是验证独立业务账的遗漏、状态解释、作用域和最终复核。仅改临时研究脚本和 M14 文档；不实施产品功能，不调用真实模型或外部业务。

当前 SmartDD `5a9e04382441e24624cb94635f9d902c543a03d7` 的迁移、run registry、资源协调锁及 MailExecutionService 重新构建，387 条输入摘要核对通过。使用实际 runFixture，prepare 后以持有的 cancelBeforeFork 收口，未启动原生进程。MailExecutionService.recover 的 ownerState 固定为 stopped；记录由合法合成行提供，SMTP submit 始终未调用。汇总与准入回执是临时候选，不是实际产品服务。

## 九项检查

| 检查 | 结果与证据边界 |
| --- | --- |
| S01 | 实际运行账 stopped 后，空业务账允许写入研究交接回执；不产生 SDK 启动或业务授权 |
| S02 | 通用调用、浏览器、无 task 的项目 UI 数据写和邮件 unknown 同时进入汇总；同字符串 operationId 不跨来源擅自合并；邮件实际恢复释放租约后仍阻止交接 |
| S03 | succeeded＋unknown、failed＋未知 effect 仍待核实；write cancelled 保守为 unknown；read cancelled 是读取未完成、无写副作用，不是业务成功 |
| S04 | 能确定属于另一项目的 UI 操作不阻断当前项目；缺失 run／task、归属冲突、无项目连接管理记录保留 unverified；尚无对象级解析能力 |
| S05 | 一个邮件 intent 的授权／执行关联作为一个项目解释；实际恢复将未使用授权 stale／grant revoked；缺失所指 execution 拒绝，未生成新发送权 |
| S06 | 最终事务重新读取所选证据并校验摘要，发现预览后的插入、无时间戳变动的状态修改和删除；不能沿用旧预览。状态修改是合成 SQL，不是业务对账接口证明 |
| S07 | 回执插入后触发 SQLite ABORT，事务无残留；实际 registry 的 prepared run 阻止新回执，之后以本宿主未 fork 证明停止 |
| S08 | 必需来源表暂不可读时返回 coverage unverified，不伪装为空集合、不放行；表恢复后外键完整 |
| S09 | 未经业务模块解析的非空 targets 保持 unverified，不根据对象名字猜允许范围 |

最终 attempt-xxtGFP 九项通过；第一次 attempt-c93kTI 八项通过后，复核认为 resolved-read 不能表达“取消读取但无写副作用”，故改为 read-incomplete 并显式分开写副作用判据，同时补未知 targets 检查。两份驱动与结果均保留，最终证据以第二次为准；没有把首次结果改写成最终版本。

独立只读审计：两条成功研究回执、所有实际 run stopped、无原生 PID、租约全部 released，SQLite integrity／foreign_key_check 通过；SMTP 调用数 0。

## 设计变化

- 数据操作 cancelled 没有独立 effect 证明。源码 catch 可把 write 的 CANCELED 写成 cancelled，不能据此推导未执行或自动重试；这是源码路径与合成行验证，没有执行真实外部写来证明某次取消产生了副作用。
- 将业务结果、运行活性、读取交付、审批和允许动作分别解释；汇总无待处理写不等于所有读取成功。
- 最终交接事务要核对来源修订／内容和覆盖范围。候选只检测预览与事务之间的变化，不证明事务后不存在新业务，也不证明未知历史从未发生。
- T3 的 releaseEntry 分别处理订阅排空、scope 关闭和释放记录；被打断的工具条目并非外部副作用结果。WillYou 的业务账继续独立解释，不从 T3 session 状态推导邮件／数据库完成。

## 未关闭范围

候选全表读取仅用于小型合成库，不是可直接投入产品的查询或性能方案。非空 targets、无归属连接管理记录和已执行邮件终态尚未接实际模块解码器，当前保守限制较宽；不能宣称完整业务汇总或精细化受限继续已经就绪。通用调用与 data operation 是否属于同次动作，需要实际来源关联后再去重；本轮只验证不因字符串相同误合并。

完整交接还须联合 binding／generation、原生与后台执行范围、工作区写权、真实业务上下文／最终授权及所有写入口的协调边界。摘要不授予权限，研究回执不触发新 run；关闭窗口后的变化、宿主崩溃、持久来源覆盖／清理墓碑和大数据量仍待验证。其他业务如文件／SSH 不因四类账为空就被视为不存在。

复现：具备归档 build.mjs 指向的固定本机依赖时，在解包目录运行 `node build.mjs`、`node probe.mjs`；使用隔离 SQLite，无真实账号。见 [结果](result.json)、[来源及边界](source-review.json)、[原始归档](raw-evidence.tar.gz)、[归档摘要](archive-manifest.json)。
