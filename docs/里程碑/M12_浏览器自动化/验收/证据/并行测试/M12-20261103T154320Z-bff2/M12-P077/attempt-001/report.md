# P077 独立短 CPU 诊断

App018/source017，2026-11-04 22:50:25–22:52:25 UTC，同一隔离 App，独立短诊断。没有修改 SkillObservationMonitor、页面后台设置、策略、T111 原时长/阈值，也不计正式用例通过。

| 同实例阶段 | 实际时长 | 整体单核 CPU | 主进程单核 CPU |
| --- | ---: | ---: | ---: |
| 无活跃 run | 20.11s | 0.5820% | 0.1907% |
| 五个真实受管 blocking caller、无浏览器页 | 30.16s | 56.9754% | 56.9332% |
| 同五 run＋五个真实停放页，五次原 CLI warm snapshot 后 | 30.10s | 60.0123% | 59.5532% |

以上使用每 PID user+system 累计秒/实际 monotonic 秒；原始区间和进程变化完整保留于 resource-samples.jsonl、阶段 JSON 和 result.json。不能从正式 T111 结果中扣掉本基线，也不能把五 active run 的成本简单归因为透明停放绘制。

随后独立采集10秒 own-main Node inspector Session CPU profile，Profiler API 实际成功，额外开销与三个普通 OS 阶段分开。main.cpuprofile 包含6132个 sample/timeDelta，采样总10.082153秒。profiler-stop-raw.json 原响应在任何形状断言前已保存；Session finally 断开。V8采样归属时间不是精确 OS CPU 耗时。

实际栈清楚命中 `SkillObservationMonitor.tick → skillObservations → ApplicationSessionDiagnostics.inspect → inspectBase → withResourceLock/withCoordinatorLock → resourceIssue → verifyPackageTree`，并命中 `inspect → skillDiscoveries → NativeUserMessages.skillObservations → assertActive/mine → session inspectCoordinated/read → canonicalJson/compareCodePoints`。因此先前仅静态候选的“每活跃 run 持续完整诊断”现在有实际栈支持，成本不限于文件哈希。

按精确 functionName+URL+V8位置，对同一目标的全部调用节点取采样并集：sessionDiagnostics.inspect 为6.269270秒、resourceIssue 为4.993064秒、withCoordinatorLock 为6.779368秒；这些包含关系有重叠，不能相加。合并完全相同 callFrame 的 self 采样：compareCodePoints 1.856373秒、fsync 1.167425秒、canonicalJson 0.355328秒，idle 2.872636秒。fsync 示例实际祖先为 `sync → remove → withCoordinatorLock`，对应 source017 coordinator-lock.ts:21、82。compareCodePoints 对应 manifest.ts:8–20，完整示例栈与精确聚合在 profile-correlation.json。

源码对应只读提取实际 App018 ASAR 中两份文件，未使用未来活动源码猜映射：out/main/index.js SHA `0e80c518a3006a6844f42b9f2bd9e4b875db8cffa7efe37b38da220b2241c18d`；foxmail-source-CFqH-pCP.js SHA `40ffae1e899e5f354d0f06a4d679a35ca3f2201e02ddb97843851e6a7e89911f`。纯文件读取其 ASAR header 与两个有限 payload，SHA 与包内 header 一致；外部当前 out 同字节也已核，但交付引用以包内提取为准。原 V8 index.js 位置比提取文件同名函数声明前4行，报告保留原位置并按符号/正文对应，不冒充已验证 source-map 精确行号；chunk compareCodePoints 对应直接一致。

App94362正常退出0/null、无 harness signal/fallback。原 raw 记录27个 known PID（早期消息误写26，以 raw 与实际 cleanup 为准）、13TCP、五Helper、准确gateway路径均已独立只读核清；父协调者另行复核通过。生产/原型/包均未写入，用户日常实例未接入。只有外部 Node 驱动与只读 sampler；合成 caller 的健康/requirements 不能视为真实模型 R 或 OS sandbox 证明。

结果支持优先修复后台完整诊断的重复工作，但不等于可删除安全核验。可由协调者在私有候选中拆开后台证据收集与完整 UI 诊断，保留真实工具调用/授权边界的完整校验，再按影响做软件与新包验证；正式 T111 仍需原完整合同复验。
