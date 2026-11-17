# 原生运行资源租约与清理计划：隔离研究

2026-11-14；R02／08／10／11，Q01／03／48／51／52／53／54；技术方案 §12.1、验证账 §4.53。没有产品代码、共享原型或正式产品验收。

## 关键发现

实际 CapabilityRunRegistry 的 native-only guard 可以把原生包作为固定资源加入同一个 run 的 capability_lease_resources，保留内容 hash 和 generation。但现有 resourceGcPlan 只读取 capability_resource_leases.resource_id，没有读取该租约的全部成员。因此仅允许 agent-native-runtime 种类与根节点的临时反例版本，会把真实运行仍占用的成员列成可删除。实验只检查计划，**没有执行这份错误计划**。

这不是宣称现产品已经删除 Agent 包：产品本来不支持该新种类作为清理根。反例证明未来迁移只加类型白名单会引入缺口。候选 planner 另读默认版本和所有未释放租约成员，验证资源身份／代次，把这些依据纳入 planHash；故障时保留并报告 issue。

当前实际 captureGcTree 也不识别原生清单。本批对小型 native 包调用实际函数得到 HASH_MISMATCH；没有把身份拒绝冒充大小测试。进一步源码核对发现其单文件上限 256 MiB，整树 512 MiB，且同步 readFileSync 整文件；当前 Codex 主程序 271011440 字节大于 268435456 字节。该大小不兼容是源码与真实包尺寸对照证据，不是执行到该分支的动态测试。

## 实际执行：attempt-4Zz48L

| 检查 | 结果 |
| --- | --- |
| L01 | 实际 guard 预留把 A 原生资源记为 lease member，而非租约主资源；原始 planner 不接受该根，原始 tree capture 不接受其清单 |
| L02 | 故意只扩种类／根的反例 planner 返回 A 可回收，即使实际 run 租约尚在；不执行删除 |
| L03 | 修正候选 planner 后，A→B 默认切换仍保留 A 的 run 占用和 B 的默认占用，A 资源代次不变 |
| L04 | 捕获的真实 Node 子进程读取 A 的受管入口并报告 A；发 stop 后 run 停在 stopping，子进程活着且占用保留；仅在退出回调后释放，B 默认仍保留 |
| L05 | A 可回收的旧计划生成后新建 run；planHash 变化，实际维护入口使用候选 planner 拒绝旧计划；新保留计划同样拒绝，没有进入 capture／move |
| L06 | 原生资源 generation 故障变更后，实际 run.prepare 拒绝，候选 planner 保留并报告成员无效；恢复夹具记录后可取消 |
| L07 | FixtureProcessReader 模拟宿主 unknown、宿主 stopped 但 armed／无 PID；实际恢复器分别保留 unknown／orphaned 与恢复租约。清理由驱动已知没有 spawn 的 cancelUnforked 完成，不假冒发现进程已退出 |
| L08 | 完整实际 Codex 0.167.1 包被 guard 租用，从该发布路径启动 app-server 并收到 initialize 响应；EOF 后真实退出，回调释放租约。未发送 turn 或调用模型 |

两个真实子进程均 code 0，无信号退出或兜底 kill；最终没有未释放 run 租约，也没有 cleanup-graph 操作。最终重新校验 41 个实际原生文件。Node 夹具 A／B 用于升级语义，不能当成两个真实 Agent 版本互换成功；真正的 Codex 场景只证明初始化与运行占用。

## 三份构建的边界

- actual：现有源码，仅适配构建资产 glob 与 CJS import.meta.url。
- naive：故意不完整的反例，仅允许原生资源 kind／root。
- candidate：仅改 planner，补默认版本、租约成员、身份检查和计划 hash；没有修改真正的文件 capture、删除／恢复 final guard 或持久历史资源合同。

固定 guard 是原生生命周期权限，代码明确不授予应用工具／业务凭据。不能拿 L08 代替完整程序化业务 run 的原生资源接入，也不能绕过该边界让业务 run 退化为 native-only。发布时校验了文件，但本批 guard.verify 仍只调用旧会话资源验证；未把“原生清单重验→受管实际 fork”联合封装起来，晚变更／路径替换仍待验证。

默认指针只是一种保留根，不能替代已接受启动材料、历史、准备阶段、安装操作和外部配置引用。实际删除前后的 final guard、崩溃恢复和新引用竞争必须用同一套依据；本批没执行删除，不能宣称原生 GC 完成。大文件清理需要独立预算和流式／worker 方案，不能通过增大旧业务桥限制解决。

## 参考 T3 与 WillYou 的设计取舍

本地 T3 CodexInstallation.remove 在安装进行中或存在运行租约时拒绝卸载，并核对配置中指向受管目录的自定义路径。WillYou 可参考这个用户行为，但应接到自身持久 run／资源成员、默认值和冻结启动依据，而不是只复制一个内存计数。T3 的这段源码没有作为跨进程租约恢复的实验依据。

## 证据

[结果](result.json)、[运行审计](runtime-audit.json)、[源码与变体依据](source-review.json)、[哈希清单](archive-manifest.json)、[脚本、三份构建与数据库](raw-evidence.tar.gz)。38 文件、9 份 SQLite 完整性／外键通过、399 个构建输入复核。native 大文件不入文档库。

复跑只在新的临时目录进行，替换记录中的绝对实验路径并安装原依赖，执行 build.mjs 后运行 probe.mjs。候选构建仅供验证，尤其 naive 绝不能用于实际资源删除。不会向用户日常配置、数据库或资源目录写入。
