# 2026-11-22 Claude Code 托管模型档位复验

本页所列的本地原件保存在本次复验所在工作区，保存位置及 SHA-256 见阶段验收目录的本地日用复验证据清单。

对应 R03 的 2026-11-22 修订和 A14 定向回归。WillYou 0.1.6 在 macOS 26.6.1 arm64 上验证，基于 `feature/0.1.6` 的 `7b2b9bb29417` 工作区构建。应用位于 `/private/tmp/willyou-claude-effort-delivery-1122/mac-arm64/WillYou.app`，`app.asar` SHA-256 为 `1df8af632c8bfd84f66dc03bad32774f81ddbb03800297cba54146950054f242`。同一临时目录保存已跟踪文件的 `tracked-source.patch` 和未跟踪生产文件的 `untracked-source.tar.gz`。相关生产文件哈希（本地 `sources.sha256`）

| 验收项 | 实际结果 | 证据 |
| --- | --- | --- |
| A14 首页和任务 DeepSeek | 官方 DeepSeek Flash 和 Pro 均显示低、高、最高，首开默认高。两模型各自记忆档位，首页与已有任务的选择相互独立。 | 实包操作与退出回执（本地 `app-results.json`） · 浅色首页（本地 `01-home-deepseek-default-light.png`） |
| A14 首页和任务 Model Hub | 合成目录声明 Claude 档位的模型显示对应选项，默认值未声明时交给供应商。仅有 Codex 档位的模型显示「由供应商决定」。切回已知模型可恢复各自选择。 | 实包操作与退出回执（本地 `app-results.json`） · 深色任务已知档位（本地 `02-task-model-hub-claude-dark.png`） · 深色任务未知档位（本地 `03-task-model-hub-unknown-dark.png`） |
| A14 首条请求、切换与恢复 | 实际任务服务和 Claude SDK 0.3.321 启动 Claude Code 2.1.329。默认 Flash 首条消息发出 `low`，同会话切 Pro 后发出 `max`。切到未知档位的 Model Hub Sonnet 时 WillYou 清除旧档位，由 CLI 采用自身默认值。切回 Flash 及服务重启后恢复原会话与 `low`。五条请求均完成。 | Claude 请求与回合记录（本地 `claude-request-results.json`） |

定向回归 10 个测试文件、256 项通过，类型检查及差异检查通过。共享原型 M14、M9、parity、M13 测试合计 390 项通过。打包后的 SQLite、PTY、语音桥、文件代理、Office 渲染和文件监听烟测通过。

实包 UI 使用私有 HOME 和 userData，按实际菜单操作，共 19 项断言通过，实例退出码为 0。模型目录和请求验证使用合成数据及回环服务，未使用实际 Model Hub 账号或调用真实供应商网关。首次 UI 驱动的表达式括号错误保留在 `/private/tmp/willyou-claude-effort-ui-1354Yl/execution-3YY4BO/result.json`，修正驱动后复用同一包通过。请求夹具初次运行时与打包过程共用的 SQLite 原生模块正重建，改用同 ABI 的临时 App 原生副本后通过。
