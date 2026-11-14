# 程序化预留与同任务多绑定：隔离技术验证

日期：2026-11-14。对应 R02／03／08，Q13／14；技术方案 §3.2.13，验证账 §4.44。仅技术研究，不修改产品或共享原型，也不执行产品验收。

## 问题与结论

前批使用旧 reserve，再由夹具补 run 的 binding／capability／generation 字段，不能据此证明新任务无需旧单会话数据即可启动准备。本批以实际源码的隔离变体新增按精确 scope 创建、读取、校验和预留的入口：新逻辑任务只创建新能力修订／引用，不填旧 snapshot／identity／refs／version 表；run 的关联、代次、固定 v1 应用计划和原有进程／资源租约在同一预留事务插入。

同一逻辑任务保留 Claude／Codex 两绑定；A→B→A 的 run 各有独立 runId，绑定内代次为 1→2。保留既有 task 级未结束运行互斥：竞争预留只有一个成功。多绑定用于串行切换；多 Agent 并行仍通过独立子任务，不放宽同任务运行互斥。

## 实际结果

最终 `attempt-5Vk7mT` 的 P01–P14 通过。真实组件包括 SQLite、能力 Schema／包与字节校验、旧注册器预留与 owner 逻辑、v1 计划读写、CurrentApplicationAuthorization 和 ApplicationToolService；新 scope 接线为临时源码变体。

| 项 | 证据范围 |
| --- | --- |
| P01／P02 | 同 task 双 scope、新任务无旧镜像；A→B→A 读取对应执行器资源、固定来源及代次 |
| P03 | 同一进程的两个异步预留竞争，一个成功，另一个 RESOURCE_BUSY；没有多宿主进程竞争实验 |
| P04 | 实际当前应用授权先拒绝停用应用，启用后两绑定依次调用合成只读 handler；停止的旧 run 仍拒绝 |
| P05／P06 | 混用 task／cap／source 或外传 generation 拒绝；预留末端注入失败，run／plan／lease／process／generation 全回滚 |
| P07 | 候选首次 native ID 关联更新当前修订，原 run 来源和 v1 计划不变，后续 run 使用新来源；ID 是夹具，不是原生回调 |
| P08／P09 | 复制 owner 句柄、篡改 generation、损坏 adapter 字节拒绝；未支持的旧 native-only fallback 明确拒绝 |
| P10 | 原旧会话继续 prepare；旧首次 native 绑定同步候选 cap 当前指针，没有被新路径漏掉 |
| P11／P12 | 改资源引用或 MCP 名称拒绝；hold 禁止使用，但仍允许拥有者取消 |
| P13／P14 | 新入口必须有固定应用计划生成器；与旧 MCP 名称冲突时发布事务回滚 |

保留全部失败及修订记录：`attempt-5pG5Gb` 在 preparing 状态误用 cancelBeforeFork，收尾失败且该项数据库未留存，不补造其现场；`attempt-xnwAqh` 使用无效的合成进程出生身份，改成实际解析器接受的格式；`attempt-2AHTCv` 的 P13 复现新入口缺失必需计划检查，候选补拒绝；`attempt-rkVf3j` 虽通过旧版十四项，但未覆盖旧首次 native 投影；扩展 P10 后 `attempt-aaSZz1` 复现组合变体漏旧投影 hook，恢复既有候选 hook 后最终全批通过。后两项是研究候选缺陷，不是已交付产品缺陷，也不能将早一轮绿测替代扩展后的结果。

## T3 对照与明确限制

T3 的 ProviderSessionBindings 迁移、ProjectionStore attached／detached 投影和 thread 查询显式关联 thread 与 provider session，支持将逻辑任务和原生会话分离的设计方向。该源码不能证明 T3 具有 WillYou 的能力快照、资源租约、业务权限或相同运行互斥规则；本批没有运行或修改 T3。

本批没有启动 OS Agent 进程、SDK／app-server、模型 turn、IPC 或 UI。进程身份为内存夹具，适配资源和业务 handler 为合成数据，不能据此证明真实进程归属、原生恢复或全部业务兼容。未把 §4.43 的两端初始化证据自动推广到本批新 reserve。

尚未闭环的设计问题：发布只接受 planned，提交成功但回包丢失后的幂等查询／接管尚未实现；完整 ExecutionPlan／配置修订／delivery／outbox 与新 reserve 未联合；真实 native ID 回调及 scoped native-only 恢复未完成；完整业务上下文服务、跨宿主竞争、应用迁移器与正式版本升级未覆盖。内部 ptyId 暂仍是启动身份字段，实际无 PTY；拟议 launchId 的最终迁移须显式完成。禁止把隔离候选直接当作产品迁移脚本。

## 证据与复跑

[最终结果](result.json)、[源码依据与变体哈希](source-review.json)、[文件清单](archive-manifest.json)、[所有轮次的驱动／候选／数据库](raw-evidence.tar.gz)。归档 263 个文件，48 份 SQLite 已核完整性／外键，418 个构建输入已核当前哈希。

恢复临时依赖与原源码基线后，依次运行 `python3 make-variants.py`、`node build.mjs`、`node probe.mjs`，每步成功再执行下一步。原始每轮输入已随 attempt 保存；复跑只能使用新的临时目录与数据，不连接用户数据库或修改产品配置。
