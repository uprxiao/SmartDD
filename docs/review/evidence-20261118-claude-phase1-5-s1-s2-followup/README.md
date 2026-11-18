# M14 S1/S2 修复对照

2026-11-18 · P0.21 原型与同工作区的隔离开发版 App。每个状态各拍三组，浅色、深色是 1440 × 900，窄窗是 950 × 780。每张图左侧为原型、右侧为 App。确认后的处置与逐项截图入口见[差异清单](../evidence-20261118-claude-phase1-5-s1-s2/原型状态差异清单.md)。

- [105 组并排图索引](manifest.json) · [构建哈希](build-sha256.txt) · [原型版本快照](../../里程碑/M14_统一Agent工作区/原型/截图/P0.21_20261118/README.md)。
- [App 检查与退出记录](app-verified/app.json) · [原型状态记录](prototype/prototype.json) · [CDP 表达式预检](logs/cdp-preflight.log)。App 使用真实 renderer、主进程和隔离 SQLite。页面导航、任务关系、查看子任务和排队编辑入口通过后台 CDP 点实际控件。播放中的流式回答和停止时钟按单个场景注入；原生及委派状态使用夹具。
- [受影响回归](logs/regression.log) · [传输回环复跑](logs/transfer-loopback.log) · [最后一处滚动修改的渲染复跑](logs/renderer-final.log) · [开发版构建](logs/build-final.log) · [类型检查](logs/typecheck.log) · [文档审计](document-audit.json) · [生成稿一致性](logs/generated-docs.log)。首次项目回归中一条本机 SSH 监听被沙箱拒绝，允许回环监听后对该文件重跑。首次开发构建的原生签名检查受沙箱限制，按本机正常签名环境重建。
- [App 驱动](state-app-cdp.mjs) · [初始数据](state-fixture.mjs) · [原型驱动](prototype-cdp.mjs) · [并排图生成](assemble-comparison.mjs)。

## 等用户决定的同数据差异

下文为决定前的状态。2026-11-18 用户已确认两项都按原型。见[修后的界面与证据](../evidence-20261118-m14-v23-v24/README.md)。

- **V23 邮件业务审批。** 取原型相同的发件人、收件人、主题和正文，App 使用生产 `mail_send` 请求的结构和四个选项。原型把邮件正文放在时间线，App 把正文和操作放在同一底部面板。隔离夹具只替换该请求的审阅回执，验证原文显示，没有发信或触发授权。 [浅色](side-by-side/light-business.png) · [深色](side-by-side/dark-business.png) · [窄窗](side-by-side/narrow-business.png)。
- **V24 跨任务网页授权。** 原型与 App 使用同一个页面地址和控制申请，均允许降级为观察。App 播种生产 `browser_access` 请求的页面数组、运行申请范围与目标任务 ID。原型展示友好名称、有效期及选项说明，App 展示结构化详情中的 ID、URL、模式和选项。没有打开该页面或绑定权限。 [浅色](side-by-side/light-access.png) · [深色](side-by-side/dark-access.png) · [窄窗](side-by-side/narrow-access.png)。

这些截图用于开发复核。真实模型和业务授权的全流程、系统输入法与打包 App A 层验收分别采用对应的执行记录。
