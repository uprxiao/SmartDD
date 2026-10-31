# PO证据

[缺陷、P/A层级、失败与剩余](../../PO_T22项目空状态与全局停用入口原型修复_20261028.md)。两个原型缺陷修复；真实App保护已有，本轮P/A各9组验证；完整T22未通过，正式35/72。

- `runs/`：10次P/A原件，含选择器故障/焦点让出/原型红/主题转场/修订oracle失败/最终绿。
- `verification.json`：独立10App退出/数据库/源/P/out/包核对。
- `driver-execution-delta.json`、`A-executed-driver.mjs`：A执行源与最终driver仅P分支有两处增量的精确比对。
- `source-overlay.tar.gz`：两原型源/一测试/一驱动/P README；`before-sources.tar.gz`含改前原件及未改参考。
- `prototype-build.json`327新静态文件/`prior-prototype-build.json`旧指纹，源P448映射；不把实时端口当历史版本。
- `audit/`：软件红绿、类型/构建日志、各驱动阶段与审计源码；`documents/`产物快照；`manifest.json`逐文件hash，不含自身。

无生产/CLI/存储授权/真实外部服务/系统输入法/剪贴板动作；A主题经真实设置菜单。数据不同，未宣称全P04视觉相等。
