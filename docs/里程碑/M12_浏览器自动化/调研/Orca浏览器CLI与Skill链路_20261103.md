# Orca 浏览器 → CLI → Skill → Agent 链路

日期：2026-11-03。依据：Orca 提交 `bd9455b6165`（仓库外 `/Users/liubu/hx/3.GitHubProject/orca`）；需求 [R0.4](../需求.md)。方法：只读源码，4 路并行阅读后由主会话抽查关键行，**没有运行 Orca**。文中“已核实”指主会话亲自对过源码行；“推断”指根据代码推理、未实测。

配套文件：[WillYou 冲突核对](WillYou冲突核对_20261103.md)。

## 1. 一句话

Orca 把浏览器做成 App 里的一个标签页。Agent 不直接碰浏览器，而是在终端里敲 `orca <命令>`；这个 CLI 连到正在运行的 Orca App，App 再让打包在里面的 agent-browser 去操作那个页面。Skill 只是一张“去哪里看说明书”的小纸条，真正的说明书由 CLI 自己打印，所以说明书和 App 版本永远一致。

```text
Agent（Codex／Claude Code，跑在 Orca 终端里）
  │ 读 Skill 桩：~/.agents/skills/orca-cli/SKILL.md
  │ 运行 orca skills get orca-cli        ← 打印编进 CLI 的说明书（不需要连 App）
  │ 运行 orca snapshot --json
  ▼
orca CLI（Orca 自己的 Electron 可执行文件以 Node 模式运行）
  │ 读 <userData>/orca-runtime.json → 得到 socket 路径＋令牌
  │ 按当前目录推断属于哪个 worktree
  ▼  Unix socket（NDJSON，一行一个请求）
Orca 主进程 runtime RPC
  │ 只比对令牌字符串
  │ 找到该 worktree 的当前标签页 → webContents
  ▼
AgentBrowserBridge（每个页面一个队列）
  │ 给该页面开一个只听 127.0.0.1 的 CDP 代理（底层是 webContents.debugger）
  │ 启动 agent-browser --session orca-tab-<页面ID> --cdp <端口> batch --json
  ▼
<webview> 里的网页
```

## 2. 浏览器本体

| 事实 | 位置 | 状态 |
| --- | --- | --- |
| 每个网页是一个 `<webview>`。主窗口打开了 `webviewTag: true` | `src/main/window/createMainWindow.ts:143` | 已核实 |
| `<webview>` 挂载时把关：只允许 profile 分区、空白路由分区、SSH 分区等白名单；强制 sandbox、contextIsolation，去掉页面预加载脚本 | `src/main/window/main-window-webview-security.ts:72-118` | 子代理读取 |
| `<webview>` 一挪 DOM 位置就会销毁，所以 Orca 把所有页面放在 worktree 层级常驻，标签换位置只改 CSS 锚点 | `browser-pane/assemble-chrome/BrowserPaneOverlayLayer.tsx:22` | 已核实 |
| 渲染进程生成页面 ID，挂好 webview 后把 `{页面ID, worktree, profile, webContentsId}` 登记到主进程；主进程维护 页面↔webContents↔worktree 的映射 | `browser-page-webview-guest-session.ts:97-110`、`src/main/browser/browser-manager-registration.ts` | 子代理读取 |
| Profile 对应一个持久分区，如 `persist:orca-browser`。**Profile 是全局的**，不属于某个 worktree；每个标签各自选 profile，换 profile 要重建 webview | `src/shared/orca-profiles.ts:336-350`、`browser-session-registry.ts` | 子代理读取 |

## 3. Agent 命令怎么落到页面上

1. RPC `browser.snapshot` 进主进程（`src/main/runtime/rpc/methods/browser-core.ts:39`）。
2. 定位目标页：有 `--page` 用它；否则取该 worktree 的当前标签；**再找不到就退回全局当前标签**（`browser-command-targets.ts`）。页面没在显示时会临时唤醒它。
3. 每个页面一个先进先出队列，不同页面可并行（`agent-browser-bridge-queue.ts`）。
4. 首次使用时先关掉同名的残留会话，再为该页开 `CdpWsProxy`（`agent-browser-bridge-lifecycle.ts:68`、`cdp-ws-proxy.ts`）。代理只接受本机回环请求，一次只服务一个客户端。
5. 启动 agent-browser：`--session orca-tab-<页面ID> --cdp <端口> batch --json`，**命令内容走标准输入的 JSON**，不放在命令行参数里，防止参数注入（`agent-browser-bridge-execution.ts:139`）。
6. agent-browser 是按架构打包的原生可执行文件 `agent-browser-darwin-<arch>`，放在 `Contents/Resources/`；它的后台进程空闲 10 分钟退出（`config/electron-builder.config.cjs:605`、`agent-browser-process-environment.ts`）。**已核实**打包配置；Orca `package.json` 里的 `node: 24` 是 Orca 自己的开发环境要求，不是 agent-browser 运行所需（推断，D6 核实项仍需实测）。
7. 不经过 agent-browser、直接用 Electron 做的：`goto`、`reload`、`pdf`、鼠标原始事件、视口、整页截图等；标签的增删切换走主进程映射。CDP 代理还会拦下 `Page.bringToFront`，防止抢用户焦点。
8. `@e3` 这类元素引用由 agent-browser 在 `snapshot` 时生成、存在它的后台进程里，**按页面隔离**。引用失效靠匹配报错文字识别为 `browser_stale_ref`（`agent-browser-bridge-process.ts:93`）；后台进程重建时引用会静默丢失。

### 用户能看到什么

- 活动标记：只有来自 CLI 的命令才计入，空闲 20 秒后消失（`browser-agent-activity.ts`）。
- Agent 光标：输入前先画光标，最多等 1.5 秒“到位”。
- 焦点保护：Agent 要点击／输入前，先让界面保存用户的焦点；150 毫秒内没回应就拒绝；用户正在用输入法组字时也拒绝（`agent-input-focus-guard.ts`）。
- **没有暂停按钮**。用户只能关掉标签来打断（`browser_tab_closed`）。

## 4. CLI 怎么连到 App

| 事实 | 位置 | 状态 |
| --- | --- | --- |
| `orca` 是一个 shell 脚本：`ELECTRON_RUN_AS_NODE=1 exec Orca.app/.../Orca out/cli/index.js`，即用 App 自带的 Electron 当 Node 运行 | `resources/darwin/bin/orca` | 已核实 |
| 全局安装是 `/usr/local/bin/orca` 符号链接，需要管理员授权；Orca 终端里另外把 `Resources/bin` 放到 PATH 最前 | `src/main/cli/cli-install-constants.ts`、`orca-cli-child-path.ts` | 子代理读取 |
| App 启动时写 `<userData>/orca-runtime.json`：pid、socket 路径、令牌；令牌每次启动新生成 | `src/shared/runtime-bootstrap.ts`、`runtime-rpc-state.ts:54` | 子代理读取 |
| **服务端只比对令牌字符串**，不查调用进程是谁；同一用户下能读到这个文件的任何进程都有完整权限 | `runtime-rpc-request-admission.ts:135-141` | 已核实 |
| 协议是一行一个 JSON；单帧上限 1MB（只限入站）；客户端默认超时 60 秒，`goto` 60 秒，`wait` 随 `--timeout` | `unix-socket-transport.ts`、`src/cli/runtime/client.ts:65` | 子代理读取 |
| **截图和 PDF 以 Base64 放在 JSON 里输出到标准输出**，文本模式只打印“截图 N KB”，不落文件 | `src/cli/browser-format.ts:18` | 已核实 |
| “当前 worktree”按当前目录（cwd）＋`ORCA_WORKTREE_ID` 推断；推断不出时**不报错，变成不限范围**；只给 `--page` 也不限范围 | `src/cli/selectors.ts:159-230` | 已核实 |
| Codex 沙箱挡住 socket 时报 `runtime_access_denied`，Skill 让 Agent“申请提权重跑”；Orca **不改** Codex 的沙箱配置 | `src/cli/runtime/runtime-access-denied.ts`、`skills/orca-cli/SKILL.md` | 已核实 |

## 5. Skill 怎么写、怎么装

**写法：桩＋说明书。** `skills/orca-cli/SKILL.md` 只有 47 行：教 Agent 选对可执行文件（`ORCA_CLI_COMMAND` → `orca-dev` → Linux 用 `orca-ide` → `orca`），然后运行 `orca skills get orca-cli`。说明书（`skill-guides/orca-cli.md` 323 行＋`references/browser.md` 65 行）在构建时编进 CLI，`skills get` 不需要连 App，沙箱里也能用。浏览器部分教的核心是“快照 → 操作 → 再快照”循环、引用失效就重新快照、并发时用 `--page` 固定页面、用 `wait --text/--url/--selector/--load` 代替死等，以及 4 个错误码的恢复方法。

**装法：一份正本＋各 Agent 的链接。**

| Agent | Skill 位置 | 说明 |
| --- | --- | --- |
| Codex | `~/.agents/skills/<名字>`（正本本身） | Codex 直接读共享目录；在 HOME 下，不在 `CODEX_HOME`，所以切 Codex 账号也能看到 |
| Claude Code | `~/.claude/skills/<名字>` → 链接到正本；设置了 `CLAUDE_CONFIG_DIR` 时用 `$CLAUDE_CONFIG_DIR/skills` | Orca 给每个 Claude 账号建一个配置目录，里面的 `skills/` 又链接回 `~/.claude/skills` |
| 其他 40 种 Agent | 各自目录或共享目录 | 表在 `src/shared/skill-install-providers.ts` |

- **不自动安装**。用户在设置页点“安装／更新”，或运行 `orca skills install`；默认装到全局（HOME），`--local` 才装到项目且只链接到已存在的 Agent 目录（`bundled-skill-install/targets.ts`、`runtime-bundled-skill-install.ts`）。
- 已有同名目录时默认不覆盖，用户选“替换”才备份到 `~/.agents/.orca-skill-backups/` 后覆盖。

## 6. Codex 和 Claude Code 的差别（用户要求记录，Claude Code 不纳入 M12）

你判断的“统一基座”是对的：**一个 CLI、一个 socket＋令牌、一份 Skill 桩、一份编进 CLI 的说明书**。每种 Agent 只差下面几处：

| 差别 | Codex | Claude Code |
| --- | --- | --- |
| Skill 放哪 | 共享目录正本 | `.claude/skills` 里的链接 |
| 身份环境变量怎么进到 Agent 跑的命令里 | Orca 用 shell 函数包住 `codex`，加 `-c shell_environment_policy.set.ORCA_WORKTREE_ID=…` 等，因为 Codex 默认会过滤子进程环境；**令牌不这样传**（`src/shared/codex-shell-function.ts:19`，已核实） | 直接继承终端环境 |
| 账号目录 | `CODEX_HOME`（仅非默认账号） | `CLAUDE_CONFIG_DIR`（按账号指针文件） |
| 沙箱 | macOS 沙箱可能挡 socket → 提权重跑 | 默认没有网络沙箱；每条 Bash 命令照常走 Claude 的权限确认，Orca **没有**预先放行 `Bash(orca:*)` |
| 其他 | 加 `--no-daemon`，每个标签独立 app-server | 剥掉继承来的 `CLAUDECODE`／`CLAUDE_CODE_*` 会话标记 |

给 WillYou 以后扩展 Claude 的含义见冲突核对 §4。

## 7. 可以略过的部分

Orca `src/main/browser/` 有 565 个文件，其中约 150 个 `browser-client-*`、`paired-runtime-*`、`browser-network-tunnel-*` 是“远程服务器上的工作区借用本机桌面显示网页”用的（错误码 `browser_host_unavailable`）。WillYou 是单机，不需要。

## 8. 未查清

- Codex 的 macOS 沙箱在“工作区可写＋开网络”时是否一定挡 socket：Orca 代码默认会挡，没有实测。
- 渲染进程如何生成页面 ID、离屏渲染（`offscreen-browser-backend.ts`）的细节没有追。
- agent-browser 的许可证原文、x64 二进制可用性、包体积仍是 D6 核实项，本次只确认了“按架构打包原生可执行文件”这一打包事实。
