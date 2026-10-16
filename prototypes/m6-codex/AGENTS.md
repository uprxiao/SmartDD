# Prototype Instructions

## M8 preparation — 2026-10-16

- Current work prepares M8 / F21 review artifacts on `feature/0.0.1`; production import/export requires the user’s review and explicit go-ahead.
- Sender and recipient both use WillYou. Transfer project-associated configuration and passwords/private keys/tokens in an encrypted package; exclude conversation history. Production export queries local SQLite and linked credentials, and import inserts transactionally. Skills are only the source of the first isolated AIS test fixture.
- Code directories have two radio choices: select a local folder (default, empty initially), or explicitly use the read-only source path. Both validate the selected target on the recipient computer; switching retains the local draft. A source package without directories disables the source choice and requires a new default main folder. Persist only the selected path; never overwrite source code files.
- The recipient can choose which attached AI profiles to import, including none and use their own profiles. Import only selected profiles and their credentials; never replace the recipient's existing/default profiles. Counts follow the selection. Always show the unchecked “导入文件中的 AI 配置” master checkbox (disabled with an explanation when no profiles are attached). Checking it selects all and reveals per-profile choices; unchecking it clears all and collapses details.
- Discard confirmation is a separate centered modal shown only when exiting an unfinished transfer, not a card appended to the form. Continue/Escape/dismiss returns to the unchanged draft; explicit discard closes the transfer.
- Export passphrases require at least 8 Unicode characters; keep the existing confirmation and 1024 UTF-8 byte maximum. Do not impose character-class rules.
- This prototype uses synthetic data only. No real file reading, encryption, credentials, network connections or database writes. Keep scenario selectors explicitly marked M8 preview. Actual encrypted AIS files stay outside the served prototype, under ignored `release/`, with the key stored separately.
- Keep existing project editing, task navigation, terminal, M7 voice and settings reachable. Reuse approved Codex typography, icon and spacing tokens. The new transfer-specific layout is proposed; no native Codex equivalent has been verified.
- M8 requirements are the source of truth: `../../docs/M8_真实项目导入导出.md`. Record scoped UI results in `../../docs/design/m8/M8_原型验收.md`.


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
