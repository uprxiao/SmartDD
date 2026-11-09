# M12 调研入口

依据：[需求初稿](../需求.md)，2026-11-02，M12-R01–R08。状态：**已有外部资料，阶段调研结论待形成**。

## 2026-11-03 链路调研与冲突核对（只读源码，未运行）

- [Orca 浏览器 → CLI → Skill → Agent 链路](Orca浏览器CLI与Skill链路_20261103.md)：浏览器本体、CLI 连接方式、Skill 写法与安装、Codex／Claude Code 差别。
- [WillYou 冲突核对](WillYou冲突核对_20261103.md)：K1–K21 冲突与约束，U1–U3 待用户决定，对 P1 与 R0.5 的影响。

## 已有资料（仓库外，未复制入库）

- `/Users/liubu/hx/3.GitHubProject/orca-browser-research/`：Orca 浏览器与 Computer Use 研究包（锁定 Orca 1.4.214，提交 `bd9455b6165`），含 16 个首版方法的 Electron 接入设计。
- `/Users/liubu/hx/3.GitHubProject/orca-paseo-lime-automation-comparison.md`：Orca／Paseo／Lime 对比。
- `/Users/liubu/hx/3.GitHubProject/lime-browser-computer-use-analysis.md`：Lime 内置浏览器、Computer Use 与 Chrome 控制分析。
- [F22-B 前期技研](../../../F22B_内置浏览器_REA调研与迁移方案.md)：Codex 浏览器静态调研。

上述资料按其自身日期理解，均为源码阅读，**没有运行过**这些项目；不能当作本阶段的实测证据。

## 2026-11-02 本轮抽查（对着 Orca 源码，未运行）

| 结论 | 依据位置（Orca 仓库） |
| --- | --- |
| Orca 的浏览器入口是 Skill＋`orca` CLI；未发现 Orca 自带的 MCP server | `skills/orca-cli/`、`skills/computer-use/`；`package.json` 无 MCP SDK 依赖 |
| 浏览器 CLI 命令注册表约 80 个键，含 profile、Cookie、环境模拟 | `src/shared/orca-browser-cli-commands.ts` |
| 很多浏览器命令转交外部辅助进程 agent-browser（`~0.27.3`），属 Vercel Labs 项目，非腾讯 | `package.json:223`、`pnpm-lock.yaml:4414` |
| Orca 没有控制用户日常 Chrome 的扩展；外部浏览器窗口只能走 Computer Use；`src/main/browser/extensions/` 是让扩展在 Orca 内置浏览器里运行的兼容层 | `skill-guides/computer-use.md`、`src/main/browser/extensions/` |
| 登录态：每个 profile 独立存储分区；可从 Chrome／Edge 导入 Cookie（Google 除外）；系统 Passkey 不支持 | `docs/site/content/docs/browser/profiles.mdx` |
| Orca 为 MIT 许可；Computer Use 原生 helper 为独立程序（macOS Swift 约 5400 行） | `LICENSE`、`native/computer-use-*` |
| 控制用户日常 Chrome 的扩展方案出自 Lime（MV3＋Native Messaging），但其来源部分取自 Codex 发货 bundle，授权状态不明 | Lime 分析文档 §4、§6 |

## 未确认项

agent-browser 的许可证原文与内部实现、Orca Cookie 导入读取并解密 Chrome 数据的具体方式、各项目在 SmartDD 目标平台上的实际表现，均未核实。

## 2026-11-02 P1／P3 专项调研（Orca 与 M11，读源码，未运行）

**问题**：Agent 调用浏览器的 CLI 入口，是照搬 Orca，还是接入 M11 的 `willyou-app`；以及是否提供跨任务操作。

| 事实 | 依据 |
| --- | --- |
| Orca 的 CLI 读用户数据目录中的运行时元数据（本机 Unix socket／命名管道＋令牌），应用必须在运行；命令符号链接装到 `/usr/local/bin/orca`（macOS 需管理员授权） | `src/cli/runtime/metadata.ts`、`src/main/cli/cli-install-constants.ts` |
| Orca **没有**解决 Codex 沙箱：连接被拒（EPERM／EACCES）时只返回 `runtime_access_denied`，提示“用提权方式在沙箱外重跑，不要重启 Orca” | `src/cli/runtime/runtime-access-denied.ts` |
| Orca 的“当前工作树”由 shell 当前目录推断；`--worktree all` 可跨工作树；令牌在用户可读的元数据文件里，任何能读到它的本机进程都可调用 | `src/cli/caller-host-worktree-selection.ts`、`references/browser.md` |
| SmartDD M11 的 `willyou-app`：独立 CLI 端点、先认证后业务、PID＋启动时间＋可执行文件校验、按本次运行计划放行；Codex 沙箱经 `-c` 临时注入只放行该 socket，用户配置不改；CLI 仅放入受管终端 PATH | M11 架构设计 §6、§6.2.1；`native/applications/cli.mm` |
| M11 沙箱注入在真实 Codex 0.166.0 上做过实验（继承具名档案时拒读与允许域名规则保留、CLI 可连、MCP 端点不可达）；但 T29（真实打包 App 的沙箱会话）尚未执行，T38 以模拟宿主为主 | M11 架构设计 §6.2.1“已验证／未验证”、M11 测试用例 T29／T38 |

**判断**：
1. 照搬 Orca 的传输层不能省掉沙箱工作——要么走 M11 已有的注入（那就仍然依赖 M11），要么让 Agent 每次申请提权（定时任务无人值守下不可接受）；
2. 本阶段会导入用户浏览器的登录态且不设域名护栏（D2、D4），本机令牌文件式鉴权风险高于 M11 的进程树校验；
3. 可以直接借用的是 Orca CLI 侧的命令定义、参数、输出格式和 Skill 指南，它们与传输层无关；
4. 因此建议混合：**Orca 的命令语义＋M11 的传输与鉴权**。需验证：80 个命令在 M11 要求的输入／输出契约下的表达方式；截图、PDF 等大结果是否在网关预算内；M11 沙箱注入在 Codex 之外的 Agent 上的可用性。
