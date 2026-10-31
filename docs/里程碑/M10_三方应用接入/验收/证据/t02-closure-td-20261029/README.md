# TD T02 原四步整例收口

正式51/72通过、剩余21、70.83%，本批只增加T02；M10仍验收中。

- [执行说明](TD_执行说明.md)、[原四步映射](original-step-mapping.json)、[改前T02](T02-before.md)
- [最终四步](final-green/result.json)、[首轮绿测](first-green/result.json)：首轮A验证为前置，最终补成明确UI测试／保存，不重复计数。
- [CDP项目选择失败](cdp-project-failure/result.json)、[原生窗口工具阻塞](native-window-blocked/result.json)、[首屏观察超时](initial-home-timeout/result.json)、[重载前置超时](reload-home-timeout/result.json)、[重载后焦点超时](reload-focus-timeout/result.json)
- [工具观察摘要](tool-observation-summary.json)、[软件证据复用及源hash](software-reuse.json)
- [独立审计](independent-audit.json)、[审计源](audit.py)、[1510选定源](current-source-baseline.json)、[19包pin](reused-package-pins.json)、[恢复关系](source-recovery.json)

A/B都是自建回环服务、账号／秘密独立，原SecretsStore和provider未替换。原四步经过真实App控件；仅初始建立A/B为I前置。无原始DB、密文、HOME或App包入库，不推论真实业务服务／Agent／发送或其他平台。
