已复现 Bug #1200「M12_SOP_2d9f7b840ac361e5 T120 总价异常」。

- **环境**：http://127.0.0.1:43547/site；macOS 26.6.1 arm64；内置浏览器 Chrome/148.0.7778.280。硬件型号未核实。
- **版本**：工单与实际页面均为 `fixture-v1`。
- **账号**：本人列表指派账号 `tester`；实际页面确认账号 `qa`。
- **步骤与结果**：登录并核对账号 → 确认单价 `10.00`、数量 `2` → 点击“计算总价”。实际显示 **20.01**，期望 **20.00**，多出 **0.01**。
- **完整性**：详情、正文、历史已完整读取，附件为空。

本轮证据均已核验并完成脱敏：

[截图](/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/projects/T120-T125/evidence/T120-20261106/reproduced.png) · [Console](/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/projects/T120-T125/evidence/T120-20261106/sanitized/console-reproduced.json) · [Network](/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/projects/T120-T125/evidence/T120-20261106/sanitized/network-reproduced.json) · [HAR](/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/projects/T120-T125/evidence/T120-20261106/sanitized/capture.redacted.har) · [完整报告](/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/projects/T120-T125/evidence/T120-20261106/report.md)

当前任务、页面及 `M12-T120-reproduction` profile 已保留，页面停留在 `20.01`。本轮未修改源码，等待你下一条消息再修复验证。
