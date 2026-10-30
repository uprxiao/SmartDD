# TB T01 原六步整例收口证据

正式49/72通过、剩余23、68.06%，仅T01新增整例；M10仍验收中。全部数据来自自建回环资源，无邮件发送。

- [执行说明](TB_执行说明.md)、[原六步映射](original-step-mapping.json)、[T01改前记录](T01-before.md)
- [最终14组](final-green/result.json)、[首轮14组](first-green/result.json)：不重复累计。
- [标签失败](label-failure/result.json)、[原生菜单失败](native-mode-failure/result.json)、[表达式失败](select-expression-failure/result.json)：0SMTP认证，原件保留。
- [69项软件输出](software-tests-output.txt)：命令为`pnpm test src/main/core/applications/__tests__/connection-service.test.ts src/main/core/applications/__tests__/smtp.test.ts src/main/core/applications/__tests__/smtp-tls.test.ts src/renderer/features/applications/panels.test.tsx`，退出0。
- [独立只读审计](independent-audit.json)、[审计源](audit.py)、[当前1509选定源](current-source-baseline.json)、[19原包pin](reused-package-pins.json)、[源恢复关系](source-recovery.json)
- [真实原生菜单操作摘要](native-actions-summary.json)：非原始AX dump。

不归档原始DB、HOME、密文或私有TLS key。safeStorage和SMTP协议未模拟；只有原自建测试数据／服务及进程内fixture CA。unsupported模式是原IPC集成非法输入，UI不能选择该值。实际发信、真实Foxmail与禅道业务不据此通过。
