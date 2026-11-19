# A33 宿主管理文件的版本校验

2026-11-19 08:58 新加坡时间，macOS arm64。A1.13，实包后台 CDP。候选 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`，ASAR `39351e634975433afb8034cda4e3a387fbd534b3f982ad56b3f88e062864dbc4`。原生 Codex 连接独立回环合成服务，项目、HOME 和 userData 单独隔离。

1. 点击原生回合给出的文件链接，在 M14 编辑器修改 V1。实际保存请求到达后，测试门闩短暂挂住处理，独立进程把同一文件写成 V2。
2. 放行未改动的生产处理器，旧 V1 基线返回冲突。V2 内容及摘要吻合，本地编辑保留，界面同时呈现两份。
3. 实际点“保留我的修改”。同一文件引用使用新操作 ID、V2 基线提交，回执和最终磁盘摘要一致。没有新增 Agent 回合或界面报错。隔离 App 正常退出，专用回环监听释放。

[冲突中保留两份](M14-A33-managed-file-both-versions.png) · [明确选择后保存成功](A33-explicit-save-keep-local.png) · [实包原始回执](result.json) · [验收核验和截图哈希](verified-a33-151-managed-cas.json) · [退出记录](cleanup.json)。

[三目录只读、取得写资格及 shell 重读证据](../../../M14-G03/4da61749f/A33-read-promotion/README.md)。2026-11-19 用户确认，强制校验覆盖宿主管理的文件写入，普通 shell 保留重读提示。
