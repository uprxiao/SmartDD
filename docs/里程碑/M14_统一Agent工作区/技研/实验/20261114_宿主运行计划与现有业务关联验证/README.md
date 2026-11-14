# 宿主运行计划与现有业务关联：独立技术实验

日期：2026-11-14。对应 R02／03／08／10／11，Q06／13／20；设计 §3.2.10，验证账 §4.41。仅技术研究；产品、共享原型及真实配置未改动。

## 结论

独立的宿主 ExecutionPlan 可以强关联现有不可变 v1 ApplicationRunPlan，并在同一 C 锁短事务中保存交付 receipt／资源 pins。只有已验证、已提交的宿主计划才可进入候选消费入口；已有 run.prepare 不表示这一步完成。R17 当前业务授权继续由真实 CurrentApplicationAuthorization／ToolService 按调用计算，不改写启动计划。

真实 AiProfileService 还暴露了旧夹具未覆盖的边界：profile runner `claude` 映射到 capability agentId `claude-code`，不能直接比较字符串；updatedAt 对更名会变化，对同一毫秒内的配置修改可能不变，不能作为唯一配置修订。既有 launchSignature 能区分实际启动内容，但包含解密后的值参与计算，只能按内部敏感证据处理，不直接变成公开计划字段。

## 实际执行与失败保留

- `attempt-oXFqDT`：E01–E10 的主体断言完成，收尾误对已停止 run 调用 cancelBeforeFork，整体失败；E11 未运行。只修驱动收尾状态判断。
- `attempt-3Umldn`：原简化 profile 夹具下 E01–E11 通过；不作为真实 profile 接入依据。
- `profile-build-failure-001`：导入被打包的 node-pty 时找不到相对 native 模块，未执行配置用例；改为对未用的发现分支注入必抛错 stub。不是 PTY 或 SDK 运行证据。
- `profile-attempt-wQtBjs`：C01–C04 经实际 AiProfileService／SecretsStore 通过，使用独立 SQLite、假加密器与可控时钟。C03 显式固定同一毫秒，不是概率性压力结果。
- `attempt-ka5VCE`：把真实服务创建的 Claude profile 交给旧候选，E01 复现 TARGET_UNAVAILABLE。属于候选设计缺口；没有把生产代码认定为缺陷。
- `attempt-ZYss9X`：修正后通过，但归档前输入摘要审计发现 receipt 解析器修改后未重建内嵌该解析器的 GC 变体；该次不是最终构建依据。保留 build-refresh-note.json 后重建两个 bundle。
- `attempt-YlE6vF`：候选 receipt 改为 v2，分别记录 profileRunner 与能力 runner，通过实际 RunnerAdapterRegistry 映射核验；E01–E11 全部通过。没有实现旧研究 receipt v1→v2 升级。

| 检查 | 证明的局部边界 |
| --- | --- |
| E01 | 无宿主计划拒绝读取／消费；提交后关联实际 v1 业务计划，先接管到实际 run lease，再释放准备 pins |
| E02–03 | pins 后／计划后注入异常均整体回滚；原预留 run 与业务计划保留，尚不能派发；重试合法 |
| E04 | 同运行同计划幂等；换 runtime 拒绝；复制序列化 handle 不能取得私有 owned 权限 |
| E05 | 重算 JSON hash 后替换 binding／run／generation／源／adapter／project 仍被关系检查拒绝 |
| E06 | 夹具 configEpoch 变化拒绝消费，但历史审计可读；未接真实配置版本生成 |
| E07–08 | 合成外部程序文件被替换时拒绝，无 PATH fallback；受管资源不在交付闭包时拒绝，成员齐备后可以解析 |
| E09 | 现有 bindNativeSession 经候选事务投影更新 current revision；两个启动计划及 source 不变 |
| E10 | 真实业务服务：未启用拒绝→启用允许一次合成只读 handler→停用后连缓存重试也拒绝；宿主计划不变 |
| E11 | 未知版本／额外密钥字段拒绝；现有 v1 计划仍由原 reader 读取 |
| C01–04 | 实际配置 runner 映射；更名与启动内容不同步；同毫秒换 Key；缺 Key 拒绝且不回退 |

## 适用范围与未证明事项

run 仍由现有 legacy reserve 创建后以夹具补候选关联，未完成新的 programmatic reserve。配置服务创建与 runner 映射是真实实现；configEpoch 是专门夹具表，未宣称已有正式配置／凭据修订事务。程序、SDK、协议版本均标 `fixture-*`，资源文件仅合成内容，没有执行 Agent、PTY、模型请求或真实业务写入。

候选 dispatch 的消费端是同步断言回调，不是 SDK 启动；私有句柄、现有资源租约、R17 及首次身份关联是真实服务路径或已注明的源码变体。没有将 SDK／app-server、完整启动取消器、全部计划读取方、子能力投影／outbox 接入同一最终协议；外部文件校验到真正 exec 的替换窗口未证明。异常回滚不等于 SIGKILL 恢复，本批未杀宿主。旧数据读取能力不等于已完成生产数据库升级／降级。

T3 本地 `ProviderInstanceConfig` 按 driver 分离私有配置；`ProviderSessionManager` 在 installation gate 内调用 adapter.openSession。此为职责划分参考，T3 没有替 SmartDD 提供 R17、source/current 双修订或新配置 revision 的保证。

## 证据与复跑

[结果](result.json)、[源码依据](source-review.json)、[归档哈希](archive-manifest.json)、[原始代码与数据库](raw-evidence.tar.gz)。当前合计 202 个归档文件、45 份 SQLite 校验成功、503 个构建输入摘要复核。最终 11 项运行计划检查与 4 项配置检查分属两个 probe，不能合称一次完整产品测试。

归档包含每次驱动／候选快照和构建后的 actual／candidate／profile CJS；恢复到临时目录并提供记录中的 better-sqlite3／zod 依赖后，运行 `node profile-probe.mjs`、`node probe.mjs`。源码重建另需 build.json 记录的原输入及 raw-import 适配；不要把实验表或变体复制到生产仓库。假密钥仅为显式 synthetic 值，不含用户凭据。
