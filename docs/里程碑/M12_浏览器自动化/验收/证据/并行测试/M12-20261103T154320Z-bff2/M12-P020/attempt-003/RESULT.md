# P020原红与软件修复

原336文件manifest及root30PID/50364/50372清场已核。原生media减少动态效果仍false，根因固定解析器需要裸reduced-motion标记，宿主传--reduced-motion reduce被忽略；已改宿主映射，6项参数U与类型检查通过，真实复验由attempt002继续。geo原观察workspace.activeId=null，未观察指定page真实prompt；分类驱动缺项，既有原生配置成功不代表页面已读到坐标。新增外部host明确page只读观察与inactive原生显示I前置，不改产品默认激活规则或权限。

原viewport主尺寸/DPR、device完整定义、真实offline与headers已绿；desktop visualViewport等于innerWidth额外判据忽略原生滚动条，旧错误判定和独立修正保留。只补geo/media，复用不变分支，不重放旧绿矩阵。

另把本轮反复出现的复制权限/运行SOURCE混用预检提成公共外部工具，两项Node行为测试通过（保留当前工具stdout的结果回执；不是原生业务结果）。不增加正式用例。正式50/121通过、71待收口，41.32%。
