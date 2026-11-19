# 候选 1da88d8f8 构建和软件回归

2026-11-19，macOS arm64，WillYou 0.1.5 本地隔离候选，源码 `1da88d8f85325d76474f1125427646aa56776848`（`feature/0.1.6`），ASAR `f06168649ff9a1eec9fb5cdbbb2238bcf9778e2613cd486a427c8bdb8df584bd`。

- D06-49 启动准备或启动门闩等待时停止，两条测试在修复前均触发旧运行打开。旧 CR03 合并场景原先依赖停止后仍打开运行，改为分别验证停止后尚未打开时不启动，以及已打开运行停止后的原生迟到回合被中断。
- D06-48 仅将 Codex 已知道的原生终态输出上限投影为 output。普通错误和上下文上限各保留旧语义。
- Agent 主进程与任务渲染端软件回归 379 项通过，7 条按环境条件跳过。类型检查通过。该批工作区保留了另一个会话对 `live-output.test.ts` 的未提交编辑。打包源码取自独立干净 checkout，只包含本次提交。 在同一干净 checkout 定向重跑任务、运行、两个执行器及投影，148 项全部通过。[冻结源码测试](1da88d8f8-frozen-regressions.log)。
- 六项打包原生检查通过，涵盖 SQLite、PTY、语音桥、文件代理、Office 渲染和文件监听。候选仅用于隔离验收。

[构建记录](package-1da88d8f8.log) · [组件 SHA-256](package-1da88d8f8-sha256.txt) · [A04 修复前回归](a04-prepare-red.log) · [A60 修复前回归](a60-codex-output-red.log) · [软件回归](a04-a60-software-final.log) · [类型检查](a04-a60-typecheck-final.log)。
