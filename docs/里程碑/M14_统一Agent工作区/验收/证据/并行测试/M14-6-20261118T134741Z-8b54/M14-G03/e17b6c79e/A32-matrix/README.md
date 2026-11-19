# A32 e17 业务启动与三组前台实包矩阵

冻结候选 e17b6c79e1c6470f44c730aca85c2f76d02efa9d，ASAR SHA-256 ec923615e4703d6124fc85f3b13a9467940b087db809176d9a998ef1a85979ac。macOS arm64，Codex 0.169.0、Claude 2.1.326，供应商响应仅回环合成。各尝试的 HOME、WillYou 用户目录、项目、任务和原生标识独立。

| 尝试 | 实际结果 | 证据 |
|---|---|---|
| 077 普通目录 Claude → Codex，业务专项 | 夹具失败。Electron Node 测试宿主通过 node:fs 读取物理 app.asar 时把归档当作虚拟目录，报 ENOENT；App 启动和 3425 绑定均未发生。外部 SHA 与该候选吻合。此步未执行插件、项目或委派。 | [种子原日志](attempt-077/seed.log) · [失败记录](attempt-077/result.json) · [原种子](driver-077-seed/seed.test.ts) |
| 078 普通目录 Codex → Claude | 持久化 queued 后原父继续通过真正工具写入，排队第二子真实取消，无原生运行。第一子等准确父退出才获唯一 active 权，真实写子文件。旧父输入等到子退出，同 binding／nativeId 的新代次读取实际字节。App PID 6756 正常退出。 | [完整结果](attempt-078/result.json) · [父回读](attempt-078/30-parent-reads-child-file-after-resume.png) · [只读释放记录](attempt-078/readonly-run-and-release-proof.json) |
| 079 Git 共用 Claude → Codex | 同样验证实际两个收据、写入、排队取消、独占及原父真实读子文件。Git 根仍是共享目录，HEAD 与 fixture 基线一致。App PID 7873 正常退出。 | [完整结果](attempt-079/result.json) · [父回读](attempt-079/30-parent-reads-child-file-after-resume.png) · [只读释放记录](attempt-079/readonly-run-and-release-proof.json) |
| 080 SVN Codex → Claude | 同样验证实际 queued、取消、父子不重叠、原绑定恢复及原生回读。App PID 9472 正常退出。 | [完整结果](attempt-080/result.json) · [父回读](attempt-080/30-parent-reads-child-file-after-resume.png) · [只读释放记录](attempt-080/readonly-run-and-release-proof.json) |

三个成功 App 无清场和 renderer 错误，本批结束后确认包进程及 3425 监听都已释放。结合 [075–076](../../15be1a81e/A32-recheck/README.md)，双向矩阵已有五组通过。普通目录 Claude → Codex 与宿主业务在途待后续尝试。

修正仅触及私有 business/seed.test.ts 的候选身份校验，改用系统 /usr/bin/shasum 读取真实 ASAR，仍要求相同哈希和精确私有路径。已经独立核验系统方式返回该候选原 SHA。 [当前驱动说明](driver/README.md) · [SHA-256](SHA256SUMS)
