# A12 权限档位、首次完全访问与原生参数（Claude Code，2026-11-19）

包 `0ee3d5c31`（`app.asar` `ae6e801b…5143ef`），真实 Codex 0.169.0 与 Claude 2.1.326，本机合成模型，后台 CDP。任务页的原生档位下拉用 Tab 取得焦点后，以按字跳选（type-ahead）切换，沿用第 049 次的真实键盘方式。驱动 [a12-tiers-packaged.mjs](a12-tiers-packaged.mjs) 由 A69 驱动改写，另带一个只读的 Codex 协议观察器，记录 `thread/start`、`thread/resume`、`turn/start` 的档位参数和 app-server 启动参数中的权限覆盖项；Claude 用 ps 读 CLI 进程的 `--permission-mode` 和 `--resume`。

## 结果（第 383 次，17 项判据，其中 1 项按原始数据重新判定）

- 任务页 Codex 档位列表为请求批准／帮我批准／完全访问，Claude 只有请求批准／完全访问，没有“自动接受编辑”。
- 任务页首次选完全访问时弹出确认框，写明“插件的写操作也不再询问，发送邮件仍会每次询问”；点取消后档位不变。
- 首页：选 Codex 时有三档，选 Claude 时没有“帮我批准”。确认框与任务页文字完全相同（M14-D06-67 修复后）；取消后仍为请求批准，确认后为完全访问。
- 从首页以完全访问建任务：任务记录为 Codex、完全访问，原生 `turn/start` 为 `never`＋`dangerFullAccess`；回到首页仍显示完全访问。
- 首页确认过以后，任务页再选完全访问不再弹框（同一份记忆）。
- Codex 原生参数（同一线程，逐轮显式下发，改档从下一轮生效）：
  - 请求批准：`on-request`＋reviewer `user`＋命名权限配置；
  - 帮我批准：`on-request`＋`auto_review`＋同一命名配置；
  - 完全访问：`never`＋`dangerFullAccess`。
  
  命名配置由 app-server 启动参数定义，为 `extends=":workspace"`（Codex 内置的工作区写入权限），只额外放行一个宿主 CLI 的 Unix socket，这是 M14-D06-11 的设计；未登记的 TCP 连接被拒绝已由 `a64-unix-probe` 对照证实。
- Claude：请求批准时 CLI 为 `--permission-mode default`；切到完全访问后开新运行代次，CLI 为 `--permission-mode bypassPermissions`，并以 `--resume` 恢复同一原生会话。
- 任务内改模型和档位后，切到另一个任务再回来仍保留；两个任务各自的档位互不影响。
- 正常退出后用同一数据重启，t1 的档位和模型保留；改回请求批准后发一轮，新 Codex 进程在重启前的同一线程上开轮，参数为请求批准档。驱动错取了另一个任务的 `thread/resume` 行，因此按原始数据[重新判定](attempt-383/rejudge.json)。

两次 App 均正常退出 0，没有 renderer 错误。插件写操作在各档位的实际行为属于 A72，不在本条重复。

## 修复的缺陷

**M14-D06-67**：首页首次完全访问确认框写的是“插件写操作仍会单独询问”，与需求相反，也与任务页不一致。修复 `0ee3d5c31`：两处共用同一份文字。界面测试红绿验证，相关界面回归 247 项通过。

## 失败过程（保留）

均为驱动错误：378 确认框选择器写成 `aria-label`（真实对话框用 `aria-labelledby`）；379 首页仍按旧的 `home-profile` 菜单操作（M14 首页用统一模型选择器）；380、381 只认 `sandboxPolicy` 字段、Claude 进程查询表用错；382 未含重启段。
