# M13 清理后全量回归

2026-11-21，macOS arm64。冻结 `feature/0.1.6` 提交 `f308e26c116e4613863d1edc48e11ce8dccc0ff1`，对应 [A61 实包候选](../../M14-G04/f308e26c1/A61/README.md)。运行入口是 `node scripts/run-tests.mjs src/main/core/applications --maxWorkers=2 --reporter=verbose`。冻结代码使用同一原生测试资源和私有 HOME、TMPDIR、测试缓存。

| 批次 | 结果 |
| --- | --- |
| 全量 | 153 个文件。146 通过、2 失败、5 跳过。2,384 项通过、2 项超时、9 项跳过。耗时 2,194.86 秒。 |
| 同提交单独复跑 | 原时限，1 worker。两个失败文件共 15 项通过、1 项原有跳过，耗时 40.61 秒。 |
| 按唯一用例合并 | 2,386 项通过、9 项跳过，剩余失败 0。 |

首轮超时保留。已单独复跑两个完整文件：

1. `browser-run-lifetime.test.ts` 的已完成命令／另一个请求取消后仍保留原授权，首次超过 5 秒的测试时限。
2. `codex-private-server.test.ts` 的 hang-request／私有服务退出判据，首次超过 10 秒的测试钩子时限。

原始日志保留在本轮私有目录，未把夹具、私有数据或原始日志复制入仓库。日志 SHA256：

- 全量 `12781586d3271b3291528824014fb0e6b9b1b3372ebc982fba0d832112dae826`，原件 `/private/tmp/willyou-a61-checks.Pj8Wer/m13-full.log`。
- 两个文件复跑 `2f49b820ad6011f96de2e044207e8e5fc0bdf395b46a193be71d5db8542e0639`，原件 `/private/tmp/willyou-a61-checks.Pj8Wer/m13-rerun.p3zFYJ/result.log`。
