# 2026-11-22 任务侧栏与模型档位复验

本页所列的本地原件保存在本次复验所在工作区，保存位置及 SHA-256 见阶段验收目录的本地日用复验证据清单。

macOS 26.6.1 arm64，WillYou 0.1.6，`feature/0.1.6` 基于 `7b2b9bb29417` 的工作区构建。生产文件哈希（本地 `sources.sha256`）

打包应用位于 `/private/tmp/willyou-sidebar-model-effort-delivery-1122/mac-arm64/WillYou.app`。`app.asar` SHA-256 为 `179d15182254511962c66e6be10a5f7aa5618b19d773358e5b2b9bd973424fe6`。打包原生烟测覆盖 SQLite、PTY、语音桥、文件桥、Office 渲染和文件监听，均通过。

| 用例 | 实际结果 | 证据 |
| --- | --- | --- |
| A48 侧栏任务操作 | 同名任务按 ID 操作。悬停、右键四项操作、重启后置顶、当前标题同步、归档草稿与撤销、删除取消和确认均通过。SQLite 核对了删除范围与外键，项目文件仍在。集成测试覆盖委派、手动终端和已归档任务的删除拦截。 | 实包操作与退出回执（本地 `app-results.json`） · 右键菜单（本地 `02-task-menu.png`） · 删除确认（本地 `04-confirm-delete.png`） |
| A14 执行器和供应商 | 首页与任务区显示真实绑定的两个供应商角标，自定义配置名仍能识别执行器及供应商，深浅色均通过。实包使用合成供应商和私有 HOME、userData。 | 实包操作与退出回执（本地 `app-results.json`） · 浅色（本地 `03-task-picker-medium.png`） · 深色（本地 `05-dark-picker.png`） |
| A14 独立档位与恢复 | 实包验证单独记忆两模型的档位，未知模型显示由供应商决定。真实 Codex 0.171.0 配合回环模拟 Responses 验证旧目录复现 `none`。修复后前两轮和恢复第三轮均发送 `medium`，原生会话 ID 一致。同会话的跨模型请求依次发送 `high`、省略档位、再省略档位、`high`，四轮完成并保留开发者指令。 | 实包档位断言（本地 `app-results.json`） · 恢复请求（本地 `codex-resume.json`） · 同会话切换请求（本地 `codex-model-switch.json`） |

类型检查和定向自动化通过。16 个测试文件共 355 个断言测试用例通过。独立回环 SMTP 夹具通过 2 项受迁移影响的回放用例。共享原型的 M14、M9、parity、M13 测试及构建通过。定向回归（本地 `targeted-tests.log`） · 迁移回放（本地 `mail-migrations.log`）

首次实包夹具遇到合成模型可用性、项目查询缓存和悬停断言序列化问题，修正夹具后完成验收。早期诊断保留在 `/private/tmp/willyou-sidebar-acceptance-pAtObA`。在同一原生会话内直接省略档位或传 `effort:null` 会继承上一轮档位，诊断保留在 `/private/tmp/willyou-effort-switch.C2LpcjdP`。最终代码通过同一次开始回合的协议设置清除旧档位。
