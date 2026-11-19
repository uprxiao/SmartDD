# M13 清理前全量回归（Claude Code 接续，2026-11-19）

冻结源码 `9a9da26a785ef3b4bb35ad1d757bfb0cdbcad030`（与当前隔离包同源），Vitest，以 Electron Node 运行 `src/main/core/applications`。隔离 HOME／TMPDIR，不注入订阅或外部服务凭据。这是清理前的回归记录，不计 A61，也不代替清理后的正式 M13 回归。

## 1. SMTP 超时项单独复跑

Codex 暂停时中断的全量里，`mail-send-data.test.ts` 的“rotates during a real in-flight SMTP send…”出现 10 秒钩子超时。用原脚本 [rerun-m13-smtp-9a9da26a7.sh](rerun-m13-smtp-9a9da26a7.sh) 在新的隔离目录单独复跑：**通过，用时 6.65 秒**。[日志](smtp-retake.log.gz)

## 2. 新隔离目录全量

原脚本 [resume-m13-9a9da26a7.sh](resume-m13-9a9da26a7.sh) `claude1`，20:43 开始，用时 2304 秒，最多 2 个工作进程：**2377 通过、8 失败、9 跳过**，另有 1 个未归属错误。[完整日志](full.log.gz)

执行期间系统负载均值约 13–15，fileproviderd、两个 Java 服务和代理在占用 CPU，均不属于本测试。

- 8 个失败中，6 个是 5 秒测试超时或异步状态尚未走到终态（如 `stopping` 尚未变成 `stopped`），1 个是并发审计计数，1 个是 `process.test.ts`。
- 那 1 个未归属错误是 `process.test.ts` 在 `listen` Unix socket 时 EINVAL：本次隔离目录名多了 `-claude1` 后缀，socket 路径超过 macOS 约 104 字节的限制。这是测试环境路径问题，不是产品行为。

## 3. 失败项逐个单独复跑

用同一冻结源码、单工作进程，每项使用独立的短路径 HOME／TMPDIR（`/private/tmp/m13r<N>`），以完整测试名精确筛选：**8 项全部通过**。[结果](reruns.json) · [脚本](m13-rerun.py) · 日志 `rerun-1.log.gz` 至 `rerun-8.log.gz`。

结论：清理前 M13 全量没有可复现的产品失败；全量中的 8 项失败可归因于高负载下的计时和超长 socket 路径，单独复跑均通过。正式清理后的 M13 回归仍按 A61 流程另跑，建议届时使用较短的隔离目录名，并在负载较低时运行。
