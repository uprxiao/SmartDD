CI 41396026050 已 completed/success，实际提交为 44b46ca42cc8fff192c4fd8ae051431f369a2b8b。workflow-check、Windows application-bundles、Mac checks 三个 job 全部成功。

Windows 原始日志确认 src/shared/application-module-catalog.json 为 i/lf、w/lf、attr/text eol=lf；元数据校验与 CLI build 均成功。发布测试实际 24/24 通过、无失败或跳过；Vitest 为 503 个文件通过、140 个按原条件跳过（643），5866 项断言通过、1000 项按原条件跳过（6866），无失败。

两段 watch 曾因网络 EOF 退出，原件保留；随后九次有界只读 API 快照跟到同一运行真实成功，不是 CI 重跑。自有进程和进程组全部退出，没有占用 UI/native/Codex 资源。旧 9bce 候选仍保留原 Windows 失败及整体取消，未被新结果覆盖。旧 9c9 CI 41393394709 最终 success，仅作独立历史。
