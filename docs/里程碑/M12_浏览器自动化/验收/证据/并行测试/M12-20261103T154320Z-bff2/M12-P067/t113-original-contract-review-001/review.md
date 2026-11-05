# Review Report

## 摘要

建议协调者将原 M12-T113 的 I＋A 判据收口。原 I15、A01–A10（App017）、A11（App020）、A12（App021）均有真实执行证据；本次仅完成跨基线适用性审查，没有重跑 App、改变预期或增加正式通过数。

## 问题清单

没有发现仍缺的原 T113 业务判据。原 case 与 R07.6 的九组判据映射见 `contract-map.json`，每个原 I/A 断言编号及原 result 身份见 `evidence-map.json`。

历史驱动／清场红继续保留：App017 原最终 raw 缺失，既有协调复核只认可从 live 与日志恢复的 A01–A10，退出 signal 未补 null；App020 的原 A12／观察器收尾失败不改。它们不应混为 T113 新业务失败。App021 A12 已以两个正常实例、同 userData 重启及独立清场覆盖其原生命周期要求。

## 修改建议

不建议为本次账面适用性缺口新开 UI 或重跑旧绿色前缀。由协调者独立复核后，在唯一账中连接本审查与原实际证据；原红与历史结论保留。

## 一致性校验

- 四个实际 source/App 根、source manifest 路径与 SHA 在 `baseline-locations.json`。47 个直接相关文件均匹配各自冻结 manifest；P064 I15 的同47项也匹配 App017 源。15 个暂停／队列／授权／等待／run 生命周期核心文件跨旧至当前相同；service 五方法与 UI/IPC 两个暂停入口共七项逐字节相同。
- App020→App021 的相关差异仅 PackageRegistry/ToolService 的 list 解析缓存；App021 A12 的真实 own CLI 成功、cross 旧授权拒绝经过当前 dispatch。App021→App022 的这47项全同；SOP资源变化不改T113。
- 对早先未决的 Helper/ref/弹框耦合已按原夹具缩清：原用的是顶层普通按钮、没有 iframe/shadow/同步弹框，也不是显式 mouse 命令。新增 hostClick、弹框延迟释放与显式鼠标跟踪分支不属于此路径；普通 Helper click 入口保持，正常 CDP ack 的 false→None 两种表达均继续普通完成分支。新版非弹框 reference finish 委托同一 disarm，仍要求 accepted click；queue admission/pause/cancel 本体不变。不能据此宣称全部 Helper 行为或二进制等价。
- Helper 实际 .4 与 .6 不同 SHA 已明列。App020/021/022 的 .6 二进制逐字节相同，各自 SOURCE 与冻结 patch SHA 匹配；四个实际 ASAR 与各自 package pin 匹配。包差异没有被隐去。

## 风险／待确认点

适用性仅限原 T113 的有限场景；不外推新增弹框/OOPIF/显式鼠标命令。重启只验证持久页面 ID/URL 与 pause/grant 清除，不声称旧 native WC 对象跨重启保留；沿用原已接受的 run-end/restart 边界。实际账变更仍由协调者完成。Native/OS/App/PTY/HTTP 执行均为0，资源占用0。
