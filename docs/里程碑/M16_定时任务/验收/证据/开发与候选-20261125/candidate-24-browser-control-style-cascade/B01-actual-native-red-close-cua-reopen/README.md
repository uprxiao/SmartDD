# C24 B01.3 实际原生红关闭：临时白名单证据

仅保留本轮独立合成数据。原 `result.json` 未改；`result-selected.json` 是白名单投影，含原路径及 SHA-256。未拷贝数据库、完整日志、日常账户、凭据或安装包。

## 独立复核（不改权威账）

- 精确 C24 App/原生源哈希一致；精确 PID 90280、测试窗口标题、真实 AXCloseButton、前台采样 14×2。操作回执为 Agent 原生自动化，非本人确认。
- 首次真实关闭：同 root 1 隐藏（visible=false、nonminimized），真实 hide/show；同 WC 2、URL、原 doc marker、未提交合成表单、activeId 与窗口几何恢复。这是驱动在回执校验前持久化的实测事实。
- 第二次独立实际 AX 关闭：AppKit 自有 on-screen normal window 数 0；真实精确 CUA App 路径重选后同 PID 数 1，原合成表单由 CUA 回执观察，退出前驱动仍见原 WC 2/原 URL 可见。Dock CUA 超时未输入。
- 第二次重选真实来源 `exact-cua-application-selection` 未被冻结的旧 C22 回执枚举接受；原真红原样保留，原输入静态复跑命中同一拒绝。不能冒称 Dock、窗口菜单或 NSRunningApplication。其后最终完整驱动断言未执行；正常 exit0 不等于测试通过。
- 真实窗口菜单仅自有唯一项。本轮实际检测两屏，红关闭均在 id1 原几何；未新增跨屏/全屏/Space 层证据。实际 PNG 是可信 shell 层，不含单独 Native 页面像素；不作系统合成画面、原生表单或无过渡闪动证明。
- 原测试 `fail` 保留；当前仅部分证据，不增加 B01.3 或 M16 正式用例通过数。

## 文件

- `result-selected.json`：本轮真实结果白名单投影。
- `B01-red-close-user-receipt-*.json`：真实原样操作回执；两份 `focus-before-close*.json` 与 OS 重选观测为原样文件。
- `B01-3-current-native-red-close-redisplay-original-page.png`：原始 shell PNG，已独立查看。
- `verification.json`：实际事实、原判据、截图及尚未通过边界。
- `preflight-and-original-red-replay.json`：相同脚本哈希、语法预检及原回执枚举真红复跑，不执行 App。
- `cleanup-observation.json`：原 PID gone、私有监听/数据句柄空；共享 3425 如实记录后续占用，不操作其他进程。
- `SHA256SUMS`：各白名单文件完整校验。
