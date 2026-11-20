# A51 实际安装包与本机 CLI（Claude Code，2026-11-20）

包 `c73070c64`（`app.asar` `63333c67…52ca`），macOS arm64。驱动 [driver/a51-launch.mjs](driver/a51-launch.mjs)。

**启动方式**：`open -g -n -a <测试包>`，即 Finder／Dock 所用的系统启动服务（LaunchServices）。调用 `open` 时只给 launchd 默认 PATH（557 发现 `open` 会转发调用者的 PATH，已改）；`--env` 只传隔离 HOME、数据目录与 CLI 配置目录，`-g` 不抢前台。隔离 HOME 的 `.zprofile`／`.zshrc` 写入 PATH 与一个本机记录代理的 `HTTP(S)_PROXY`。未直接点 Finder 图标，因那样无法隔离数据目录，会碰用户日常数据。

第 560 次 5/5：

| 判据 | 结果 |
| --- | --- |
| 进程由 launchd 拉起（父进程 1），使用测试包与隔离数据目录 | 通过 |
| 进程自身 PATH 仅 `/usr/bin:/bin:/usr/sbin:/sbin`，无终端环境与代理变量 | 通过 |
| 经登录 shell 发现真实 Claude（`~/.local/bin/claude` 2.1.329）与 Codex（0.169.0） | 通过 |
| 显式路径指定 Claude 2.1.326 有效，可恢复为自动发现 | 通过 |
| 从该 App 发起一轮真实 Claude 对话完成；收到 SIGTERM 正常退出 | 通过 |

包库存（[inventory.json](inventory.json)）：锁定 SDK JS 库 0.3.321，`app.asar` 5108 项、Resources 18466 个文件，无 SDK 平台原生包、无内置 claude／codex 可执行文件。SQLite／PTY：打包原生检查通过；手动 PTY 真实 shell 见 A52 第 547 次（同包）。

**代理（观察，待用户决定）**：559／560 在回合进行中读取 CLI 进程自身环境——有登录 shell 的 PATH，但**没有**登录 shell 里设置的 `HTTPS_PROXY`／`HTTP_PROXY`；本机记录代理零请求。即从 Finder／Dock 启动时，只在 shell 配置文件里设代理的用户，CLI 不会经该代理联网。代码中没有代理处理；用例“明确预期”未列代理判定。

**平台**：按需求 R01，首期真实平台为 macOS arm64；Windows、Linux 未执行，保留未验，不宣称支持。
