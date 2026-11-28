# C24 B08 原生项目导出 Save 实际复验（2026-11-27）

**真实 macOS Save 已成功：精确独立 PID/父窗、两段实际前台、正确私有保存路径、正常真实回执及合成项目认证产物均通过。**

- 两段各14个真实前台观察，分别持续3294/3305ms，同一 PID93794、root 1。实际 Go To 精确私有 artifacts 后保存默认文件名，无覆盖。
- Electron 原真实 Save API 返回 canceled:false、filePath 精确相同；壳界面显示“项目已导出”与同一绝对路径，已独立看实际原图。
- 唯一合成 .willyou 文件1077字节、SHA一致、严格加密封套结构；原运行中以瞬时合成口令认证，项目、目录及无凭据均正确，无口令或明文留存。只归档摘要和SHA，原加密产物留本轮私有目录。
- 旧 C22 Cancel 的真实回执和零文件证据为历史引证，不冒充C24 fresh Cancel。
- AppKit 的 /tmp 与 canonical /private/tmp 同一文件；本次样本为 canonical 路径，不事后构造原始别名。
- App 正常退出0，两精确PID ESRCH；原端口3425/58668在后续组前核空，闭库完整且0凭据/模型会话。

[真实结果原图](project-export-success.png) · [实际索引](index.json) · [清场](support/cleanup.json)。
