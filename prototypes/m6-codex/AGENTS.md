# M10 R1.6 当前原型约定 — 2026-10-19

- 当前已确认规则以需求§12.1–12.20为准，优先于下方R1.5历史描述；本轮已补主流程、邮件单一来源／发件账号及可操作故障状态，依据新增需求§12.21；实际验证与未覆盖项见README顶部，不把原型当后台验收。
- 应用包版本固定于会话；resume不换包、不向能力未知历史自动补入。项目启用、当前连接／权限、健康和加载证据分别显示。应用不可用不阻塞Agent。禅道每项目至多一个当前连接，切换先停止相关运行，失败保留原选择；没有自动兜底。普通编辑不得替换已有账号身份。
- 邮件以Agent处理为主；页面保留配置／来源状态／轻量草稿及结果。默认30天、最大100天。SMTP只影响发送，不阻止草稿。明确结果与unknown分开，不自动重发。每项目最多一个读取来源与一个SMTP发件账号，两者可独立不选；切换不改写旧草稿或旧来源引用，发送前核对绑定修订。首版Foxmail只读本机来源，无导出导入后备。
- 原型仅合成数据。localStorage仍用原隔离键；草稿只保存固定fixture元数据，由代码重建合成正文，不保存用户输入的邮件正文或秘密。真实SQLite、后台、Agent适配不在此次源码修改范围。
- 升级占用状态必须实际阻止模拟默认版本切换；保留历史引用。移除／停用不删业务数据或历史包。首版目标WillYou内macOS arm64＋CC/Codex；模拟准备不可标成真实发现／调用。

# M10 A14 邮件入口收窄 — 2026-10-19（当前设计）

- 当前邮件页面范围以 `../../docs/里程碑/M10_三方应用接入/需求.md` §12.15 为准：Agent处理为主，页面保留配置／状态、轻量草稿和发送结果／调用记录；完整收件箱、独立阅读器及手工写信工作台不作为首版必需交付。复用后台能力，不要求页面先启动Agent。
- 这一决定更新P06/P07候选范围，旧V3画面和历史结果不当作新范围已实现。源码与新状态验证待统一更新；中央终端、合成数据和不自动Enter规则继续有效，不构成生产开发授权。

# M10 应用包设计决定 — 2026-10-19

- 当前需求为 `../../docs/里程碑/M10_三方应用接入/需求.md` R1.5／M10-R10。用户确认应用与一个或多个配套Skill默认打包在一起，应用有独立版本；项目选用应用时一并提供工具和Skill，不再要求两处分别启用。独立通用Skill继续保留原管理入口。
- 应用包随WillYou程序包升级；本地SQLite保存连接、项目绑定、业务记录及版本／迁移状态，升级继续读取原数据。秘密仍由加密存储管理；原型保持合成localStorage边界，不实际操作SQLite或Foxmail文件。
- 用户随后明确授权把本节加入原型：当前V3已补应用版本／包内容、项目内「应用」页签与全局选用同步、配套Skill归属、会话模拟加载及升级演示。页面待用户再次评审，历史V2截图／检查仍只代表R1.3。版本1.0.0／1.1.0和迁移都是演示值；全局／项目状态使用同一个内存源与既有隔离localStorage键。独立插件市场／热更新和生产开发未获本次授权。

# M10 原型与技研授权 — 2026-10-17（历史依据，Skill组织以R1.5为准）

- 用户已认可统一连接配置、项目按需选用、Agent工具调用与可选Skill的组织方式，授权继续Codex REA、M10可操作原型和技术评审资料；不是生产业务开发或发布授权。依据 `../../docs/里程碑/M10_三方应用接入/需求.md` R1.3。
- 入口 `?preview=m10#apps`；独立模块 `IntegrationWorkspace.jsx`、`integration-model.mjs`、`integration.css`；保护既有M6–M9改动。用户截图为目录视觉参考，新增业务页面是待评审WillYou设计，未核对状态不宣称完全一致。
- 范围为禅道Bug＋Story、Foxmail本地读取、单独发件候选；Jenkins仅做扩展研究，不提供真实连接／构建动作；Ticket、飞书、调度不扩入。
- 原型仅使用合成数据，禁止真实账号／网络／邮箱文件访问。localStorage只用 `willyou-m10-prototype-v2`，不保存秘密输入或邮件正文；仅有存在标志和公开示例配置。测试变更使就绪结果失效，停用／断开／项目绑定各自处理。
- 中央终端保留；外部对象引用带实际选用连接，插入当前／最近同项目运行终端输入，不自动Enter。多个目标歧义时不选第一条冒充当前。未知发件不自动重发，旧发送回执不能影响新草稿。
- Codex研究沿用已保存包证据并补新模块，原型不操作Codex账号／插件。真实禅道动作、发件后端／授权、缓存清理及平台仍待评审。用户后续批准正式开发后按阶段入口承接，不以此原型授权推定。

# Prototype Instructions

## M9 visual reference update — 2026-10-17 19:46

- The user supplied a new Codex file-workspace screenshot and explicitly requires identical layout and code highlighting. Use the archived image and evidence limits in `../../docs/里程碑/M9_文件浏览工作区/原型/代码与文件区视觉对照_20261017.md`. Align file tabs with the window title strip, breadcrumb/tool spacing, format icons, line numbers, code typography and individual syntax roles. Keep the production App and prototype consistent. This continues the authorized M9 scope; it does not add a chat UI. Do not claim unverified themes, languages, fonts or states are exact matches.

## Current R3.4 authorization — 2026-10-17

The user authorized fixing the nine remaining issues. Continue that scope; D01 independent terminal/disk view, D07 local-only and full-path drag stay confirmed. Current results are in `docs/里程碑/M9_文件浏览工作区/九项问题处理结果_R3.4.md`. Prototype fixes and the existing App PTY ownership fix are implemented; complete M9 production delivery and packaged acceptance are not complete. The latest user allows REA/Computer Use research, superseding the old user ban below. The historical Computer Use safety denial for Codex still cannot be bypassed through other tools or copies. Older statements of scope/authorization below describe their historical revision when they conflict with this note.

## M9 preparation — 2026-10-17

- Current handoff: requirements/docs and runtime are R3.3-20261017. The user confirmed D01: terminal CLIs operate files under their own permissions and user instructions; WillYou adds no second approval and never attributes disk changes to a CLI request. File viewing/refresh is independent. Only unsaved manual edits require ordinary external-change conflict protection. Production implementation still needs the overall review.
- D07=A is confirmed: M9 is a local-machine IDE-style workspace, with the terminal on the left and local tree/viewers/editors on the right. Complete file-path dragging refers to local paths. R3.3 removes the interactive remote-environment demo switch and its branches; remote host browsing/SFTP read-write/sync are historical research or future scope, not current M9 blockers. Keep normal failed/readonly/unknown states, local capability checks, host-identity rejection, and unrelated existing project SSH configuration. No production integration or release is implied.
- R3.2 removes the selection-edit pending/review/keep/revert lifecycle and terminal-submitted matching. A selection instruction ends at insertion into terminal input, never Enter; cancel closes its draft and cannot stop/undo the CLI. Keep independent synthetic external-file-change and directory-refresh demos explicitly labelled.
- R3.2 file drag: tree files, file tabs and file image previews supply an ephemeral current-task file token. Drop into the terminal inserts the complete absolute fixture path only, preserves existing input, adds a separating space and focuses the terminal; no content, attachments, @ prefix, automatic Enter or implicit task start. Reject control/bidi/invalid path characters rather than sanitising into another filename. Consume successful tokens once; invalidate on drag end, task/root changes or unmount. Keep tab-to-tab reordering. Real root leases, file authorization, native drop and CLI/voice behavior remain production work.
- Read the stage's `开发前收口与待确认.md`. The later user instruction recorded in M9-D14 prohibits further operating or viewing Codex; earlier capture plans are superseded. Continue with permitted existing references and this isolated prototype. The batch counts below are dated history; the model suite still contains 155 tests. Its 155/155 result and the 24/24 focused browser result are R3.2 history, not R3.3 reruns. R3.3 affected local UI checks passed 5/5 and the prototype build passed; no complete model/browser suite rerun.
- Preserve the existing REA evidence of the file workspace (not the browser). Current M9 design, prototype, technical plan and applicable cases follow the confirmed local-only D07=A scope. Production implementation requires the subsequent review; do not interpret prototype code as authorization.
- Start from `../../docs/里程碑/M9_文件浏览工作区/README.md`. Keep M6/M7/M8 and the central terminal. Resource tabs are distinct from excluded task tabs.
- M9 uses synthetic fixtures and its own browser localStorage key `willyou-m9-prototype-v1`. Never read real project files, launch apps, call models/services, or use real credentials from this prototype. Binary downloads use `.preview.txt` and must not masquerade as real Office/PDF files.
- Tree assets under `public/assets/m9-file-icons` are the pinned Apache-2.0 upstream; preserve SOURCE, LICENSE and NOTICE. Private Codex overrides and attachment/tab icons remain explicit differences.
- R3 batch 3 history (2026-10-17; selection-edit review and submitted events were removed by R3.2): business loop prototype — `src/file-reference-model.mjs` (sanitize/pasteData/buildInsertion/selection-edit state machine) and `src/file-viewer-policy.mjs` (MCP viewer policy), both pure and shared with isolated experiments; reference tray + "insert into terminal input" (never sends Enter) + "ask CLI to edit selection" review banner in `FileWorkspace.jsx`; demo terminal in `App.jsx` listens to `m9:terminal-insert` / `m9:terminal-config` and emits `m9:terminal-submitted`. The historical tray/banner rendered above `.fw-footer`. Model tests 145/145 (`pnpm test:m9`); browser check `docs/里程碑/M9_文件浏览工作区/验收/证据/r3-business-loop-check.mjs` 24/24. Production gaps recorded, not fixed: `ptyInputEvent` unscoped (src/main/index.ts:133), SSH host keys unverified (ssh-tester.ts; historical/future remote work, excluded from current local M9 by D07=A).
- R3 batch 2 (2026-10-17): PDF viewer now renders real PDFs with pdf.js (pdfjs-dist 5.4.296, lazy chunk + worker; sources under `public/assets/m9-pdf`, synthetic, encrypted sample password `m9-user` is a demo value). Notebook Markdown uses the same markdown-it pipeline and highlight.js 11.11.1. IME checks must use `imeComposing` from `src/file-ime.mjs` (React synthetic `isComposing` is unreliable). Browser checks live in `docs/里程碑/M9_文件浏览工作区/验收/证据/r3-*.mjs`; run them against the dev server on 4176 with a clean localStorage per case. That batch passed 128/128 model checks. Not verified: real Worker crash, thousands of pages, non-embedded CJK fonts (no cMap configured), real IME, touch.
- R3 first batch (2026-10-17): Markdown rendering now uses markdown-it (HTML disabled) + KaTeX + Mermaid (strict, `htmlLabels:false`, lazy import) + js-yaml; blocks still carry exact source offsets and edit only their own range. Dependencies are exact-pinned in package.json (lockfileVersion stays 3). New synthetic fixtures `docs/Markdown语法全集.md` and `docs/Markdown异常样例.md`. That batch passed 112/112 model checks. Not a CodeMirror equivalent; cross-block selection, math-internal selection, fence highlighting and dark-theme Mermaid are unverified.
- M9 full design QA remains blocked by reference/runtime and feature-parity gaps. R1 ten scenarios remain historical. R2 adds twenty REA scenario groups and three supplemental browser checks; M9 model checks 101/101 pass. Read the execution record: neither these limited synthetic checks nor earlier phase QA prove full M9 parity.

## M8 preparation history — 2026-10-16

- Historical preparation scope: M8 / F21 review artifacts on `feature/0.0.1`. The user subsequently approved production development; implementation and macOS arm64 acceptance were completed on 2026-10-17. Start from `../../docs/里程碑/M8_真实项目导入导出/README.md`; do not revoke that authorization or treat the history below as current pending development. This prototype still uses synthetic data.
- Sender and recipient both use WillYou. Transfer project-associated configuration and passwords/private keys/tokens in an encrypted package; exclude conversation history. Production export queries local SQLite and linked credentials, and import inserts transactionally. Skills are only the source of the first isolated AIS test fixture.
- Code directories have two radio choices: select a local folder (default, empty initially), or explicitly use the read-only source path. Both validate the selected target on the recipient computer; switching retains the local draft. A source package without directories disables the source choice and requires a new default main folder. Persist only the selected path; never overwrite source code files.
- The recipient can choose which attached AI profiles to import, including none and use their own profiles. Import only selected profiles and their credentials; never replace the recipient's existing/default profiles. Counts follow the selection. Always show the unchecked “导入文件中的 AI 配置” master checkbox (disabled with an explanation when no profiles are attached). Checking it selects all and reveals per-profile choices; unchecking it clears all and collapses details.
- Discard confirmation is a separate centered modal shown only when exiting an unfinished transfer, not a card appended to the form. Continue/Escape/dismiss returns to the unchanged draft; explicit discard closes the transfer.
- Export passphrases require at least 8 Unicode characters; keep the existing confirmation and 1024 UTF-8 byte maximum. Do not impose character-class rules.
- This prototype uses synthetic data only. No real file reading, encryption, credentials, network connections or database writes. Keep scenario selectors explicitly marked M8 preview. Actual encrypted AIS files stay outside the served prototype, under ignored `release/`, with the key stored separately.
- Keep existing project editing, task navigation, terminal, M7 voice and settings reachable. Reuse approved Codex typography, icon and spacing tokens. The new transfer-specific layout is proposed; no native Codex equivalent has been verified.
- M8 requirements are the source of truth: `../../docs/里程碑/M8_真实项目导入导出/需求.md`. Record scoped UI results in `../../docs/里程碑/M8_真实项目导入导出/原型/原型说明与变更.md`.


## M7 preparation — 2026-10-16

- Current request is Yoda source research, additions to this approved high-fidelity prototype, and an actionable M7 requirements/technical document. This round does not implement production voice services or publish a release.
- Work on `feature/0.0.1`. Keep the separate local voice experiment on `feature/typeless-special-test`.
- M7 / F17-A uses installed Typeless: a microphone on the home composer and settings test field, plus configurable global activation (used directly in the terminal) and a dedicated voice settings page. Keep every existing page and the terminal workspace.
- Use small M7 labels on the preview entry and voice settings. Prototype scenarios and example insertion must clearly say they are simulated; do not start audio capture, launch Typeless, register native shortcuts, change permissions, or read real settings from this browser prototype.
- Own recording, models, text processing and dictionary stay in F17-B. UI shows request status only; it cannot know Typeless recording status from a successful launch.
- Use the current approved production logo for WillYou (exact spelling): jade teal tile, white ant lifting a barbell, no eyes (2026-10-16 final choice). Sync `public/assets/app-icon.png` with `src/assets/branding/app-icon.png` using the root icon export script. The earlier 06 / 70% design remains an archived alternative. Preserve earlier QA as history and append scoped verification.

## M6 production authorization — 2026-10-16

- The user reviewed the prototype and authorized production integration on the existing `feature/0.0.1` branch, followed by testing and release. The dated decisions below retain the earlier prototype phase history; they do not block the approved production work. This directory remains an isolated design reference. Production evidence is in `../../docs/M6_实施与验收记录.md`.

## User decisions — 2026-10-15

- 2026-10-16 字体补充（`codex-clipboard-IVLNeH.png`）：以实际 Codex 侧栏逐项对齐字体家族、字号、字重、行高、行距、颜色和长标题渐隐，不能仅称“相似”。本机桌面样式使用系统字体与 430 默认字重、14px 正文／21px 行高、18px 标题／24px 行高；浅色截图侧栏 `#fcfcfc`、文字 `#3b3e40`。保留 SmartDD 品牌和业务状态；不把运行状态误当未读状态来加粗。更完整的长期规则见根目录 `../../AGENTS.md` 的“Codex UI 细粒度复刻”。

- 2026-10-16 最新确认（`codex-clipboard-1HSHMT.png` / `codex-clipboard-2MQXQ8.png`）：取消运行任务横向标签和重复面包屑，窗口顶栏仅当前会话标题；左侧项目会话切换，保留各终端状态。更多菜单保留结束／恢复与主题，右侧保留任务信息及新建。终端删除语音按钮，使用 SmartDD 全局快捷键直接输入；首页和设置试用 Mic 保留。原型的终端语音模拟移到更多菜单，明确标为模拟，不注册系统快捷键。

- 2026-10-16 语音反馈补充：唤起中和成功时不弹浮动提示卡；只在失败、权限不足或配置异常时提示。按钮自身保留短暂忙碌状态。原型“演示文字回填”移到顶部预览控件区，不恢复成功浮层，正式产品不出现演示按钮。

- 2026-10-16 补充参考 `codex-clipboard-14gupv.png`、`codex-clipboard-qo0GPi.png`：应用导航选中时使用实心图标与浅灰圆角底，未选中为灰色线框；悬停与选中分别处理，蓝点保留在首页，不能跟随选中项移动。同步生产实现和原型的浅／深色状态；不因参考图里出现 Spaces 而恢复已明确排除的入口。

- M6 steps 1 and 2 only: reference analysis and interactive prototype. Step 3 (production integration) requires the user's review first.
- The user requires Codex's actual layout and UI to be reproduced, not merely a similar minimal style. Keep SmartDD's own functionality and approved ant logo.
- Central task content remains the native terminal; do not introduce a chat message UI or structured tool cards.
- Settings must replace the project sidebar with Codex's narrow app rail, settings navigation, and separate content panel. Match the supplied Codex screenshot for proportions, typography, spacing, color, cards, and controls. Do not retain an additional project sidebar on this route.
- User reference: `/var/folders/xy/r637tyl545g2yc51_mf33l3h0000gn/T/codex-clipboard-gz6EYJ.png` (3024 × 1898 pixels). The rejected first prototype is `codex-clipboard-nZxZBL.png`. Actual screenshots take precedence over inferred styles from the installed bundle.
- Do not claim unobserved pages or themes are pixel matched. Keep remaining reference/verification gaps visible in the QA record.
- Additional user references: `codex-clipboard-6kZoEF.png` (project hover actions/detail popup), `codex-clipboard-WDy1aa.png` (task context menu), and `codex-clipboard-8OhNnB.png` (home/welcome and bottom composer), all in the same clipboard directory, 3024 × 1898. Reproduce the actual home composition and small interactions, including hover-only actions, popup position, outside-click/Escape dismissal and context-menu behavior. Use SmartDD's current menu capabilities (rename, archive/restore, delete); do not add production features solely to duplicate Codex menu labels.
- Latest reference `codex-clipboard-WMKKUc.png`: remove the Spaces entry; keep the clock / scheduled-tasks navigation and its visual states. Scheduling is F16 in the future backlog, not a current implementation. The entry may open a clearly marked planned-feature placeholder; do not create timers, scheduled jobs or real CLI runs. Existing SmartDD projects remain available from their sidebar.
- Functional parity is mandatory: the user accepts the current visual direction but requires every existing SmartDD feature to retain a corresponding page and reachable action. Audit against the current production renderer, not only the PRD. Project editing must expose overview, directories, databases, servers, capabilities and tasks; do not reduce it to name/path. Record feature mapping and gaps. Prototype data remains isolated; actual backend integration still follows user review.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

- 2026-10-16 会话归档追加确认：任务右键／更多菜单仅保留重命名、归档／取消归档，去掉会话删除。运行中先确认“结束并归档”；归档后在已归档列表及搜索可查，支持撤销／查看，取消归档回原项目且不自动启动。中央终端及其他项目／配置删除规则不变。
