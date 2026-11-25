# 证据复核与重跑

原始运行根 `/private/tmp/willyou-f36-compat-51flr0t2`，共享冻结根 `/private/tmp/willyou-f36-lab-tljocnfp/baseline`（Git `a0acddb3a2325c6bf732adaa7e954ce4d767a2c3`）。本目录只保存证据、运行器和新增软件诊断 fixture，不复制整个 App 源码、原生资源、node_modules 或任何用户数据。原始 stdout ANSI 与第一次静态输入缺失错误均保留。

如需重跑，在新的 `/private/tmp/willyou-f36-compat-*` 根中准备独立 `source`：从同一冻结提交提取 `src, resources, drizzle, native, plugins, build, prototypes/m6-codex, scripts, package.json, pnpm-lock.yaml, vitest.config.ts, tsconfig*.json`；按依赖锁准备 Electron ABI 的 `node_modules`，单独的 `cache,tmp,home,logs`。将证据中的 runner、manifest、诊断 fixture 复制到对应相对位置，按 `manifest.json` 校验既有测试源 SHA-256。首次完整重跑须从 `a0acddb3a` 原 Git blob 补齐 `static-input-supplement.json` 记录的静态文件。不要将旧失败误作待修业务缺陷。

`python3 run_tests.py` 执行 17 个既有软件用例文件；`python3 run_shape_diagnostics.py` 执行两项额外宿主形状诊断。仅 Electron bundled Node，禁止启动日常 App。本报告不包含候选 package 验收。
