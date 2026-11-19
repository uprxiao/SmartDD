# M13 清理前全量回归暂停记录

2026-11-19，用户要求暂停并交接。冻结源码 `9a9da26a785ef3b4bb35ad1d757bfb0cdbcad030`，Vitest v4.1.11，以 Electron Node 运行 `src/main/core/applications`，最多 2 个工作进程。隔离 HOME、TMPDIR 和本机夹具，不注入订阅或外部服务凭据。

全量未结束。暂停前日志记录 384 个通过项和 1 个失败项。失败项是 `mail-send-data.test.ts` 中 `rotates during a real in-flight SMTP send…` 的 10 秒测试钩子超时。退出码 130。原批次及测试端口已退出，没有执行单项复跑。该批结果不计正式 M13 通过，也不计 A61。

- [暂停点](progress.json) · [完整暂停日志](interrupted.log.gz)
- 继续时先在同源码单独复验该超时项，再从新隔离目录重跑全量，保持旧日志。脚本归档及哈希见 [SHA256SUMS](SHA256SUMS)。
