# T130 App022 D04/D06 最小005

新005仅承接原D04跨根同名标签与D06 dirty预览保护。004的App021/source025静态稿、003焦点超时与旧红均冻结；002已绿D12/D13按lineage具体SHA引用，不重放，不重复任何U。

原判据不变：D04 rootA/rootB同名文件交替打开，两个标签的标题/tooltip可区分根、内容与未保存草稿独立；D06修改预览A后单击B，A草稿不被静默丢弃，B可独立查看。原data-file-path修复保留，真实UI打开/编辑/切换；不由RPC/store替代业务。

当前包App022/source026，8项相关冻结源码与App021/source025逐字相同；ASAR内packed main/renderer340项payload逐字相同。完整source并非相同，browser0.1.1/SOP变化如实记录；NodePTY unpacked bytes已知有差异，不声称所有Native相同，当前官方App022六native smoke门槛真实已绿。此次不构建。

执行前Node cache已私有，所有RPC前置→一次reload→本次exactPID/exe/userData Native+DOM+visible连续3秒→一次原guard；无activate/show/focus抢回、无重arm。需要本次真实前台，最多300秒被动等待。Native授权后命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-t130-app022-tabs-005/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t130-app022-tabs-005/cache/node node /private/tmp/willyou-m12-t130-app022-tabs-005/run.mjs --execute
```

原driver负责raw-first、正常quit、已知PID/TCP/Unix精确核验及独立judge。只运行两段，预计实际业务1–2分钟，另首次前台等待/正常清场。当前仅静态，App/Native/PTY/OS/CLI/model/HTTP0，资源=[]；整条T130/T145不预判通过。
