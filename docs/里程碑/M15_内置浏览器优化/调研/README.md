# M15 内置浏览器调研及隔离验证

2026-11-23，关联 [R0.1 需求](../需求.md)。WillYou 可在现有每标签 CDP 和浏览器身份上实现阶段目标。Orca 的 CLI 与 Skill 保留细粒度控制。T3 Code 将复用、新建及展示意图放在一次开页调用中。Codex 将联网查找、真实网页操作与结果验证衔接，并提供受控 CDP。 [Orca 调研](../../M12_浏览器自动化/调研/Orca浏览器CLI与Skill链路_20261103.md) · [T3 开页处理](https://github.com/pingdotgg/t3code/blob/fe59fa44d0f12ba1e58b1cccc2c888ac99e743da/apps/server/src/mcp/toolkits/preview/handlers.ts#L198) · [Codex 浏览器](https://learn.chatgpt.com/docs/browser)

| 用例 | 实际结果 |
| --- | --- |
| R01，先显示后加载 | 5 次均在网站响应前挂载目标视图，随后由同一视图加载。 |
| R02，登录身份复用 | 真实提交模拟站点登录一次。同一身份的新标签直接进入业务页，独立身份进入登录页。 |
| R03、R04，报表筛选及导出 | 从旧入口转到替代入口后执行筛选，单步调用与脚本各 5 次。每次核对 CSV 正文，报表生成与下载各执行一次。 |
| R04，脚本执行耗时 | 从业务页就绪到 CSV 校验，逐条调用中位数 201.87 毫秒，范围 188.55–204.15 毫秒。单段 CDP 脚本中位数 85.66 毫秒，范围 85.14–86.03 毫秒。 |

环境为 Electron 42.11.14、当前浏览器代理和 helper、WillYou 安装包自带 agent-browser 与本机模拟站点。交替执行两条路径并校验下载内容。原始结果保存在本机 `/private/tmp/willyou-browser-study-1123.n77C1a/result.json`，SHA-256 为 `1863ca4dd0c7e3b42948f01b93278288aea26e6aef60c91fe59d4e82e3aa428e`。

实验覆盖浏览器执行和页面状态顺序。真实 SSO、模型自主找入口、打包 App 整轮耗时和 Playwright 脚本兼容性需要正式验收。重点先验证 [同页代理](../../../../src/main/core/browser/cdp-proxy.ts) 上的脚本操作，再检查现有脚本要求的 [Playwright CDP 连接](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。
