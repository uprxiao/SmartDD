# C24 B10 忙碌时真实退出：取消后原任务仍在途、确认正常退出（2026-11-27）

**代表性真实原生忙碌退出子流程通过。** 两次物理 Cmd-Q，真实 macOS 忙碌提示分别选取消／退出。四段各14个真实前台样本（3287／3301／3300／3289ms），每个样本实际 raw.exe 与 canonical.exe 同一文件、PID97360；原 C22 失焦失败保留。

- 取消后原 PID、窗口、页面 ID、WebContents、renderer PID、profile、URL、文档及本机 marker 相同；真实合成模型 QUIT 请求仅一次且取消后仍 held。
- 旧驱动使用 camelCase turnId，而当前快照原字段为 snake_case turn_id，活体对比字段未序列化。闭库仅按本轮 taskId 读非内容字段，2条 user turn 同一 run；第二条开始于取消前、结束于最终确认后，独立印证原工作持续在途，不冒充已有实时唯一turn ID对照。
- 确认后原 App code0/signal null，五个记录 metrics PID 独立 ESRCH，CDP59022 无监听，无 WAL/SHM，immutable 只读聚合0秘密、0 provider secret、0计划。共享3425在后续组已占用；已核原driver在产出end前 await fixture.close。
- 真实 stderr 来自通用 scenario finally 的退出后无关 schedule dump（普通 -readonly 文件路径，WAL-format闭库）。此前实际 B10 immutable count 及退出均已完成；最后截图也因 app=null 未产生。原始两条警告均保留。不能将无关快照缺项写成产品错误或冒充截图完成。
- 仅归档安全原图/结构化回执/夹具摘要及索引；没有复制整DB、真实凭据、原始日志或含休眠Credential分支的完整测试源。完整原driver/fixture仍以精确SHA引用私有运行目录。

[实际索引](index.json) · [原页壳原图](owned-page-shell-before-busy.png) · [tail warnings](support/tail-warnings.json) · [turn边界](support/turn-boundary.json) · [清场](support/cleanup.json)。
