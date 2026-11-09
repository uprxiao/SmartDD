# D6 agent-browser 核实、E1 与 E2 实验

日期：2026-11-03。依据：需求 [R0.5](../需求.md) D6、P1、R07.5；[冲突核对](../调研/WillYou冲突核对_20261103.md)。环境：macOS（Darwin 25.6.0）arm64，Electron 42.11.14（仓库依赖），Codex 0.166.0（仅版本核对）。层级：技研实验，**不是**打包 App 验收，也没有经过 WillYou 网关。

## 1. D6 四项门槛

样本：npm `agent-browser@0.27.3`（Orca 锁定 `~0.27.3`），`npm pack --ignore-scripts` 下载到隔离目录，tgz SHA-256 `732f8416363917f2696ef318972c479b79ca778cb2d2e5c2294952df86baca59`。安装包没有解压进仓库。

| 门槛 | 结果 | 依据 |
| --- | --- | --- |
| ① 许可证 | **通过**。包内 `LICENSE` 是 Apache License 2.0 全文（201 行），npm 元数据同为 Apache-2.0，包内**没有 NOTICE 文件**。随包分发须附带 LICENSE 全文并在来源声明中列出 | 包内 `LICENSE`、`package.json` |
| ② macOS arm64／x64 | **通过（x64 仅 Rosetta 下运行）**。`bin/` 自带 `agent-browser-darwin-arm64`（Mach-O arm64）和 `agent-browser-darwin-x64`（Mach-O x86_64），单架构、临时签名（adhoc、linker-signed），只链接系统库（CoreFoundation、libiconv、libSystem）。arm64 本机 `--version` 输出 `agent-browser 0.27.3`；x64 用 `arch -x86_64` 在 Rosetta 下同样输出。最低系统 arm64 11.0、x64 10.12。打包时需重新签名并加入原生检查（`lipo -archs`）。真 x64 机器未测 | `file`、`otool -L`、`codesign -dv` |
| ③ Node 版本 | **不需要 Node**。`engines: node>=24` 只约束包内的 JS 启动器和构建脚本；可执行文件是 Rust 编译的原生程序，Orca 也是直接调用原生文件。`postinstall` 只在缺少原生文件时从 GitHub 下载，包里已自带，打包时不执行它 | `package.json`、`scripts/postinstall.js`、`bin/agent-browser.js` |
| ④ 包体积 | **通过**。单个架构约 10–11MB（arm64 10.1MB、x64 11.0MB）；另需 `skills/`（4KB）和 `skill-data/`（168KB），因为 agent-browser 从最近的 `skills/` 目录读取自带说明。npm 全包 75.8MB，其中多数是其他平台的可执行文件，不需要打包 | `ls -la bin`、`du` |

**新发现，需要在 P2 里处理**：agent-browser 自带几条与浏览器操作无关、且带外部副作用的子命令：
- `chat`：用自然语言驱动，内含 `ai-gateway.vercel.sh`。
- `dashboard start`：在 4848 端口启动本机服务。
- `install`：下载浏览器。
- `--session-name`：把 Cookie 和 localStorage 存到磁盘。

二进制里还内嵌了 browserbase、browser-use 等云端服务的地址。Orca 的 `exec` 透传没有拦这些子命令（核对 `orca/src/main/browser/agent-browser-*.ts`）。建议在 P2 已决的“拒绝目标覆盖参数”之外，`exec` 再拒绝 `chat`、`dashboard`、`install`、`doctor`、`--session-name`、`--provider` 等，只放行浏览器操作类命令。这一条需用户在评审时确认。字符串扫描未发现遥测标记，运行 `--version`／`--help` 后也没有向隔离 HOME 写任何文件。这只说明这两条命令的行为，不代表全部命令都不联网。

## 2. P1 第 1 项：令牌能否进到 Codex 的命令

**已有证据，不重复实验。** M11 用例 T01 已通过（I＋A＋R）：真实 UI 启动 Codex 0.166.0 → 读取按运行投放的 Skill → 包内 `willyou-app` → 对端核验 → 返回只读结果（[M11 测试用例](../../M11_应用接入标准化/验收/测试用例.md) T01 行）。这说明 `WILLYOU_RUN_TOKEN` 能到达 Codex 执行的命令。适用范围：Codex 0.166.0、macOS arm64、M11 那次的沙箱配置。冲突核对 K21 由“很可能”改为**已由 M11 T01 证实（arm64）**。

## 3. E1：agent-browser 能否驱动 Electron 42 的页面

目录：[实验/E1_agent-browser驱动Electron](实验/E1_agent-browser驱动Electron/)，含 `main.cjs`、`page.html`、`run.mjs`，各场景结果在 `结果/`，源码哈希见 `结果/source-sha256.txt`。场景由环境变量切换（`E1_SHOW`、`E1_NO_THROTTLE`、`E1_VIEW_HIDDEN`、`E1_VIEW_OFFSCREEN`、`E1_VIEW_TINY`、`E1_PARK`），默认路径在添加开关后没有变化。每次运行都检查了进程收尾，没有遗留 Electron 或 agent-browser 进程。做法如下：
- Electron 42 主窗口里放一个 `WebContentsView`，使用独立的持久分区 `persist:e1-browser`，和 WillYou 的 HTML 预览写法一致。
- 用 `--remote-debugging-port` 暴露 CDP，按 Orca 的调用方式运行 agent-browser：`--session e1 --cdp <端口> batch --json`，命令以 JSON 从标准输入传入。
- HOME、userData、agent-browser 的 socket 目录都放在临时目录。
- 没有实现 Orca 那种“每页一个 CDP 代理”，也没有经过 WillYou 网关。

### 3.1 功能

| 步骤 | 结果 |
| --- | --- |
| 首次连接并列标签 | 通过；同时能看到宿主界面页和测试页两个目标（说明直接暴露调试端口会让 Agent 看到 App 自己的界面，**必须**改用 Orca 那种每页代理，对应冲突核对 K1、K6） |
| 切换标签 | 需用 agent-browser 的标签 ID（如 `t1`），不接受序号；Orca 的 `tab switch --index` 是自己在主进程实现的 |
| `snapshot` | 通过，返回引用（`@e2` 按钮、`@e3` 输入框） |
| `fill` → `click` → `get text` | 通过，页面文字变为“已登录：alice” |
| `screenshot <路径>` | 通过，直接写文件（可见时约 13KB），支持 O6“存成文件返回路径” |
| `eval`、`reload` | 通过 |
| 刷新后用旧引用点击 | 返回错误 `Unknown ref: e2`，与 Orca 的识别规则 `/unknown ref/` 一致；需求里的“锁版本＋契约测试”可直接用这条报错作断言 |

### 3.2 耗时（单条命令，本机 arm64，5 次取值）

| 场景 | 首次连接 | 快照（热） | 点击 | 截图 |
| --- | --- | --- | --- | --- |
| 窗口可见、页面可见 | 112ms | 4–5ms | 8–16ms | 40ms |
| 窗口隐藏（`show:false`） | 118ms | 4–5ms | **约 5010ms** | 51ms |
| 窗口隐藏＋关闭后台节流 | — | — | **约 5013ms** | 49ms |
| 窗口可见、**页面视图 `setVisible(false)`** | — | — | **约 2400–2600ms** | **卡住，30 秒超时** |
| 窗口可见、页面视图挪到窗口外 | — | — | **约 5010ms** | **卡住，30 秒超时** |
| 窗口可见、页面视图缩成 1×1 | — | — | **约 5010ms** | 只有 1 像素，无用 |
| 窗口可见、页面视图挪到**已显示但透明（opacity 0）、不接收鼠标的停放窗口** | 113ms | 5ms | **8–13ms** | 47ms，内容正确 |

结论：
- agent-browser 本身很快，单条命令只要几毫秒到几十毫秒。M11 网关每条命令另有身份校验开销（K17），需要在 P1 经网关实测。
- **页面不在屏幕上绘制时，点击会多等 2.5–5 秒，截图会卡住。** 这正对应 R07.5：切到别的任务后，后台页面仍要能被 Agent 操作。这一点和 Orca 源码中的“截图前临时恢复绘制”（`browser-manager-visibility.ts` 的 paint hold）吻合。关闭后台节流不能解决。
- 所以 R07.5 的实现须加一条约束：Agent 命令落到不可见页面时，宿主要让该页面继续绘制。停放窗口方案实测可行（§3.3）。

### 3.3 停放窗口方案（PARK）

做法：另开一个 `BrowserWindow`，设置 `opacity: 0`、`focusable: false`、`skipTaskbar`、`setIgnoreMouseEvents(true)`，再用 `showInactive()` 显示，并先加载一个空白页；把页面视图从主窗口 `removeChildView` 后，用 `addChildView` 挂到停放窗口，保持原尺寸。

结果：全部步骤通过，点击 8–13ms，截图 47ms，内容正确（[截图](实验/E1_agent-browser驱动Electron/结果/停放窗口_截图.png)显示“已登录：alice”）。页面视图在两个窗口之间移动后，页面状态和 agent-browser 会话都没有丢。

**范围更正（2026-11-03，[Review 20261103-1542](../../../review/review-20261103-1542.md) D06）**：E1 在宿主就绪之前就把页面移进了停放窗口，agent-browser 是在停放之后才第一次连接的。所以这里证明的只是“停放中的页面可以被连接和驱动”，**没有**证明“已连接的页面移窗后会话不丢”，也没有测试挂回主窗口。上一句“移动后页面状态和会话都没有丢”属于过宽表述，以本段为准。review 在透明停放窗口中还观察到点击约 5 秒、个别点击返回成功但没有生效，原因未定。这些都列入 S1 的代理验证矩阵（技术方案 §11、T107）。E1 脚本只记录 helper 的 `ok` 与原始结果，没有单独的语义判定，引用时以原始 JSON 为准（D12）。

失败记录：第一次 PARK 运行时，停放窗口没有加载页面，agent-browser 连接后卡在这个空白目标上，所有步骤都 30 秒超时。这是**夹具错误**，不是方案失败；给停放窗口加载空白页后重跑通过。两次结果都已归档。这也提醒正式实现：agent-browser 只能连到专属的每页代理，不能让它看到停放窗口或宿主界面这类目标。

未验证：
- 透明窗口在多显示器、全屏空间、调度中心里是否会被用户看到或干扰窗口切换。
- 长时间停放的内存与耗电。
- 用户切回该任务时，页面视图挂回主窗口有没有闪烁。

这些需要在真实 App 里做系统层验证。

## 3A. E2：M11 网关的单条耗时与 1MB 上限

目录：[实验/E2_网关耗时与大结果](实验/E2_网关耗时与大结果/)，结果在 `结果/result.json`。做法如下：
- 复用 M11 的原生 CLI 测试夹具：真实编译的 `willyou-app`、真实进程身份助手、真实网关、真实 SQLite 与运行计划。
- 调用 `mail.draft.list`。测大小的场景把数据源替换成合成草稿，这些草稿符合该能力的输出格式。
- 没有经过 Codex，也不是打包 App。按用户同意的“借用现有测试夹具”方式做，没有改业务代码。
- 用单独的 vitest 配置和私有缓存目录运行，结束后检查过，没有遗留进程或临时目录。

### 耗时（本机 arm64，热态各 20 次）

| 命令 | 最小 | 中位 | P90 | 最大 |
| --- | --- | --- | --- | --- |
| `willyou-app --list` | 49ms | 62ms | 76ms | 83ms |
| `willyou-app mail draft list --limit 1` | 148ms | 249ms | 309ms | 309ms |

解读：
- 一条业务命令的宿主开销中位约 250ms，大约是 agent-browser 本身（约 5ms）的 50 倍。按“快照 → 点击 → 快照”算，网关开销约 0.75 秒，可以接受，但所有命令里它占主要部分。
- 推断（未逐段剖析）：这 250ms 包括 CLI 先做一次 list，再做 call，两次都要启动身份助手并校验可执行文件，另外还要写调用记录。
- 优化可以等正式开发时再看，例如同一连接内复用 list 结果、缓存身份校验。现在不影响方案选择。

### 结果大小

| 合成结果 | 实际字节 | 结果 |
| --- | --- | --- |
| 100 条 | 0.32MB | 成功，0.16 秒 |
| 150 条 | 0.93MB | 成功，0.17 秒 |
| 200 条 | 1.24MB | **退出码 2，错误 `TOO_LARGE`：“响应超过本次预算，请使用分页或有界资源”**，不可重试 |

结论：超过上限时，宿主在业务层就会返回明确错误，并不是断开连接（`tool-service.ts:172`，上限为 1MiB 减 4KB）。这纠正了冲突核对 K11 里“超出直接断开连接”的说法。浏览器的大结果仍需按 O6 写成文件再返回路径：截图、PDF，以及可能超过 1MB 的快照、`console`、`network` 都要走这条路，否则 Agent 只会收到 `TOO_LARGE`。

## 4. 对需求与后续的影响

- D6 四项门槛**通过**，可以继续用 agent-browser；x64 真机验证保留为 C6 的一部分。
- P2 建议增加 `exec` 子命令拒绝清单（见 §1 新发现），需用户确认。
- R07.5 需增加“后台页面继续绘制”的实现约束：建议采用停放窗口方案（§3.3），写入需求 R0.6；未验证的系统层项目进入用例。
- 冲突核对 K21 改为已证实（arm64）。
- P1 经网关的两项已测（§3A）：单条命令中位约 250ms；超过 1MB 返回 `TOO_LARGE`。参数类型（K13）和标准输入（K14）已由源码确认，需要 M11 改动，不另做实验。
- **P1 结论（建议）**：采用混合方案可行，即命令定义与浏览器执行沿用 Orca，传输与鉴权走 M11 网关。前提是 M11 完成 D12（令牌续期）、大结果转文件、标准输入、无连接模块注册这四项改动。
