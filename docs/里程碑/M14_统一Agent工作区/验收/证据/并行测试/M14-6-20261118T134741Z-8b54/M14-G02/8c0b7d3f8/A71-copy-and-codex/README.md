# A71 复制全文（系统剪贴板）与 Codex 普通回答（Claude Code，2026-11-19）

隔离包 `8c0b7d3f8`（`app.asar` `dbece4ec…642f2`，签名核对通过）。macOS arm64。

## 第 208 次：复制全文写入真实系统剪贴板

- 用户 2026-11-19 授权本次测试临时使用系统剪贴板。驱动启动前用 JXA 在内存中完整备份了剪贴板（1 项、4 种类型，不落盘、不进证据），结束后原样恢复，并重新读取核对，结果一致（`pasteboard.restored = true`）。备份恢复工具在开跑前单独做过往返验证。
- 与第 058 次相同的计划（12,500 行，含 emoji，150,071 字节），由真实 Claude SDK／CLI 交出，计划卡出现在请求面板等待批准。驱动实点“复制”，界面提示“已复制计划”；系统剪贴板 changeCount 从 4485 变为 4486，类型为 `public.utf8-plain-text`（另有 Chromium 附带的来源类型）；用 `pbpaste` 读回 150,071 字节，SHA-256 与计划原文一致（`c59d6007…`）。
- 复制期间审批请求仍挂起，模型没有写任何文件。App 正常退出 0，没有 renderer 错误。
- 输入方式：后台 CDP 实点，页面焦点用 CDP 焦点模拟，测试窗口没有被拉到系统前台；剪贴板的写入和读回都发生在真实系统剪贴板上。

驱动：[plan-copy-a71.mjs](plan-copy-a71.mjs)（由第 058 次的保存驱动改出，前半段计划卡展示与来源核对不变），[a71-pasteboard.mjs](a71-pasteboard.mjs)。[结果](attempt-208/result.json) · [复制时界面](attempt-208/copy-while-waiting.png)

## 第 345 次：真实 Codex 以普通回答给出计划

- Codex CLI 接 DeepSeek 官方 API（只发合成内容，经本机转发，App 内没有真实 Key）。在任务里说“先出个计划再做：新建 plan-target.txt……”。
- Codex 先以普通助手正文写出三步计划，随后执行并汇报。宿主时间线没有 `proposed_plan` 条目，界面没有计划卡、计划审批或计划模式开关；5 次上游请求全部成功。App 正常退出 0。

[结果](attempt-345/result.json) · [界面](attempt-345/20-live-result.png) · [驱动](source-shared-review-live.mjs)（新增 `a71` 场景）
