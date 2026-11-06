Bug #1201 **本次未复现**：总价实际显示 **20.00**。但版本不一致，不能据此认定原版本已修复。

- **环境**：`http://127.0.0.1:43327/site`；macOS 26.6.1；内置 Chromium 148.0.7778.280；ARM64，设备型号未核实。
- **版本**：工单为 `fixture-v1`，实际页面为 `fixture-fixed`。
- **账号**：登录后页头确认是 `qa`，全程沿用同一 profile。
- **步骤与结果**：核对单价 10.00、数量 2，点击“计算总价”一次，结果为 20.00；console 同步记录 20.00，总价接口返回 200。
- **限制**：缺少 fixture-v1 实例及源码，原版本根因和修复状态仍待验证。

证据均已核对成功回执及脱敏：[截图](/private/tmp/willyou-m12-t121-app022-retest-001/runtime-001/projects/T121/m12-evidence/result.png)、[console](/private/tmp/willyou-m12-t121-app022-retest-001/runtime-001/projects/T121/m12-evidence/result-console.redacted.json)、[network](/private/tmp/willyou-m12-t121-app022-retest-001/runtime-001/projects/T121/m12-evidence/result-network.redacted.json)、[HAR](/private/tmp/willyou-m12-t121-app022-retest-001/runtime-001/projects/T121/m12-evidence/result.redacted.har)、[未复现说明](/private/tmp/willyou-m12-t121-app022-retest-001/runtime-001/projects/T121/m12-evidence/未复现说明.md)。
