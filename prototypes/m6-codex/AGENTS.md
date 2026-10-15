# Prototype Instructions

## Current authorization — 2026-10-16

- The user reviewed the prototype and authorized production integration on the existing `feature/0.0.1` branch, followed by testing and release. The dated decisions below retain the earlier prototype phase history; they do not block the approved production work. This directory remains an isolated design reference. Production evidence is in `../../docs/M6_实施与验收记录.md`.

## User decisions — 2026-10-15

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
